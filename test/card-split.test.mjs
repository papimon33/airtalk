/* 긴 발화를 문장 끝에서 카드로 나누기 회귀 — 쉬지 않고 말하면 엔진이 <end> 를 주지 않아 카드가 한없이 길어진다.
   엔진은 '확정 원문 덩어리 → 그 번역 덩어리'를 번갈아 보낸다. 번역이 문장을 끝내면 거기까지의 원문만 확정하고,
   그 뒤에 이미 확정된 다음 문장 앞머리는 새 카드로 넘어가야 한다(앞 카드에 섞이거나 사라지면 안 된다). */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until } from './helpers/boot.mjs';

test('번역이 문장을 끝내면 그 문장까지 확정하고, 다음 문장 앞머리는 새 카드로 넘긴다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });
  const cookie = await loginAdmin(srv.base);
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: '카드 나누기', pipeline: 'soniox', preset: 'oneway', src: 'mic', inLang: 'zh' }) }).then((r) => r.json());
  const ws = new WebSocket(`${srv.base.replace('http', 'ws')}/ws/host?session=${sess.id}&src=mic&out=ko&in=zh&pipeline=soniox&audioOut=0&sxMode=one&sxTarget=ko`, { headers: { Cookie: cookie } });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  t.after(() => ws.close());
  const conn = await fake.nextConnection();
  await conn.waitConfig;
  assert.equal(conn.config.max_endpoint_delay_ms, 2000, '화면이 끊김 값을 안 보내면 기본 2000ms(0 → 최솟값 500ms 가 되면 문장 중간에서 잘린다)');

  const S1 = '我现在正在大陆出差，住在一家很不错的商务酒店里，刚回到房间整理了一下行李。';
  const T1 = '저는 지금 중국 본토에 출장 와서 꽤 괜찮은 비즈니스 호텔에 묵고 있고, 방금 방에 돌아와 짐을 좀 정리했어요.';
  // 원문 문장 1 확정 → 그 번역 확정 → 다음 문장 앞머리 확정(번역은 아직)
  conn.sendTokens([
    { text: S1, is_final: true, language: 'zh', confidence: 0.98 },
    { text: T1, is_final: true, translation_status: 'translation', source_language: 'zh', language: 'ko' },
    { text: '结果YouTube', is_final: true, language: 'zh', confidence: 0.97 },
  ]);
  await until(() => messages.some((m) => m.type === 'sentence' && !m.draft && m.source === S1), { desc: '첫 문장이 <end> 없이 확정' });
  const first = messages.find((m) => m.type === 'sentence' && !m.draft && m.source === S1);
  assert.equal(first.texts.ko, T1);

  // 다음 문장 앞머리는 새 카드에서 이어진다
  conn.sendTokens([{ text: '开不了', is_final: false, language: 'zh' }]);
  await until(() => messages.some((m) => m.type === 'sentence' && m.draft && m.id !== first.id && String(m.source || '').startsWith('结果YouTube')), { desc: '다음 문장 앞머리가 새 카드에' });
  conn.sendTokens([
    { text: '开不了。', is_final: true, language: 'zh', confidence: 0.97 },
    { text: '그런데 YouTube가 안 열리더라고요.', is_final: true, translation_status: 'translation', source_language: 'zh', language: 'ko' },
  ]);
  conn.end();
  await until(() => messages.some((m) => m.type === 'sentence' && !m.draft && m.source === '结果YouTube开不了。'), { desc: '둘째 문장 확정' });
  const second = messages.find((m) => m.type === 'sentence' && !m.draft && m.source === '结果YouTube开不了。');
  assert.notEqual(second.id, first.id);
  assert.equal(second.texts.ko, '그런데 YouTube가 안 열리더라고요.');
});

test('짧은 문장은 나누지 않고 한 카드에 모은다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });
  const cookie = await loginAdmin(srv.base);
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: '짧은 문장', pipeline: 'soniox', preset: 'oneway', src: 'mic', inLang: 'zh' }) }).then((r) => r.json());
  const ws = new WebSocket(`${srv.base.replace('http', 'ws')}/ws/host?session=${sess.id}&src=mic&out=ko&in=zh&pipeline=soniox&audioOut=0&sxMode=one&sxTarget=ko`, { headers: { Cookie: cookie } });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  t.after(() => ws.close());
  const conn = await fake.nextConnection();
  await conn.waitConfig;
  conn.sendTokens([
    { text: '好。', is_final: true, language: 'zh', confidence: 0.98 },
    { text: '좋아요.', is_final: true, translation_status: 'translation', source_language: 'zh', language: 'ko' },
    { text: '没关系。', is_final: true, language: 'zh', confidence: 0.98 },
    { text: ' 괜찮아요.', is_final: true, translation_status: 'translation', source_language: 'zh', language: 'ko' },
  ]);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(messages.filter((m) => m.type === 'sentence' && !m.draft).length, 0, '짧은 문장은 <end> 전에 확정하지 않는다');
  conn.end();
  await until(() => messages.some((m) => m.type === 'sentence' && !m.draft && m.source === '好。没关系。'), { desc: '<end> 에서 한 카드로 확정' });
});
