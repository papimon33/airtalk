/* 에이전트 텍스트 입력(v6): 이 기기에서 재생하는 TTS 문장을 엔진에 재생 속도대로 알린다 (가짜 엔진·가짜 TTS, 무과금).
   스피커 소리가 마이크로 다시 들어와도 엔진이 사용자 말로 적지 않게 하는 기능 — 2026-11 실험에서 샌 TTS 99% → 0. */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket, { WebSocketServer } from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until, wait, viewerToken } from './helpers/boot.mjs';

// 가짜 Cartesia: 문장마다 0.2초 조각 3개(0.6초) + done
function startFakeCartesia() {
  const wss = new WebSocketServer({ port: 0 });
  const requests = [];
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      requests.push(m);
      const pcm = Buffer.alloc(9600).toString('base64');
      for (let i = 0; i < 3; i++) ws.send(JSON.stringify({ type: 'chunk', context_id: m.context_id, data: pcm }));
      ws.send(JSON.stringify({ type: 'done', context_id: m.context_id }));
    });
  });
  return new Promise((res) => wss.on('listening', () => res({ url: `ws://127.0.0.1:${wss.address().port}`, requests, close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }) })));
}

async function setup(t, { audioOut = '1', env = {} } = {}) {
  const fake = await startFakeSoniox();
  const cart = await startFakeCartesia();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url, CARTESIA_API_KEY: 'test-cartesia', CARTESIA_TTS_WS_URL: cart.url, ...env });
  t.after(async () => { await srv.stop(); await fake.close(); await cart.close(); });
  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '견학', pipeline: 'soniox', preset: 'oneway' }) }).then((r) => r.json());
  const wsBase = srv.base.replace('http', 'ws');
  const host = new WebSocket(`${wsBase}/ws/host?session=${sess.id}&src=mic&pipeline=soniox&sxMode=one&sxTarget=ja&in=ko&tts=1&audioOut=${audioOut}`, { headers: { Cookie: cookie } });
  const hostAudio = [];
  host.on('message', (d, bin) => { if (!bin) { try { const m = JSON.parse(d.toString()); if (m.type === 'audio') hostAudio.push(m); } catch {} } });
  await new Promise((res, rej) => { host.once('open', res); host.once('error', rej); });
  t.after(() => { try { host.close(); } catch {} });
  const c = await fake.nextConnection();
  await c.waitConfig;
  const say = (ko, ja) => { c.sendTokens([{ text: ko, is_final: true, language: 'ko' }, { text: ja, is_final: true, translation_status: 'translation', language: 'ja', source_language: 'ko' }]); c.end(); };
  return { srv, c, cart, cookie, sess, say, hostAudio };
}
const agentTexts = (c) => c.texts.filter((m) => m.type === 'agent_text');

test('이 기기에서 TTS 를 재생하면 그 문장을 재생 속도대로 엔진에 알리고 문장 끝을 표시한다', { timeout: 60000 }, async (t) => {
  const { c, say, hostAudio } = await setup(t);
  assert.equal(c.config.enable_agent_text_input, true, '설정에서 켜져야 함');
  say('안녕하세요.', 'こんにちは。');
  await until(() => agentTexts(c).some((m) => m.end_of_segment), { desc: '문장 끝 표시' });
  assert.ok(hostAudio.length >= 3, '이 기기로 음성이 가야 함');
  assert.equal(agentTexts(c).map((m) => m.text).join(''), 'こんにちは。');
  assert.equal(agentTexts(c).filter((m) => m.end_of_segment).length, 1);
});

test('뷰어만 듣고 이 기기에서는 재생하지 않으면 보내지 않는다', { timeout: 60000 }, async (t) => {
  const { srv, c, cart, cookie, sess, say } = await setup(t, { audioOut: '0' });
  const tok = await viewerToken(srv.base, cookie, sess.id);
  const viewer = new WebSocket(`${srv.base.replace('http', 'ws')}/ws/viewer?session=${sess.id}&t=${tok}`);
  await new Promise((res, rej) => { viewer.once('open', res); viewer.once('error', rej); });
  t.after(() => { try { viewer.close(); } catch {} });
  viewer.send(JSON.stringify({ type: 'audioSub', on: true }));
  await wait(200);
  say('반갑습니다.', 'はじめまして。');
  await until(() => cart.requests.some((r) => /はじめまして/.test(r.transcript || '')), { desc: '뷰어용 합성' });
  await wait(1500);
  assert.equal(agentTexts(c).length, 0, '뷰어 기기의 재생 시각은 알 수 없어 보내지 않는다');
});

test('SONIOX_AGENT_TEXT=0 이면 끈다', { timeout: 60000 }, async (t) => {
  const { c, say, hostAudio } = await setup(t, { env: { SONIOX_AGENT_TEXT: '0' } });
  assert.equal(c.config.enable_agent_text_input, undefined);
  say('안녕하세요.', 'こんにちは。');
  await until(() => hostAudio.length >= 3, { desc: '이 기기로 음성' });
  await wait(1200);
  assert.equal(agentTexts(c).length, 0);
});
