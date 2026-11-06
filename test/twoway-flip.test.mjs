/* 양방향 한 채널: 다음 사람의 말이 앞 카드에 붙지 않아야 한다 (가짜 엔진, 무과금).
   2026-11 v6 실측: 엔진은 원문을 언어가 하나인 덩어리로 확정하고 번역을 바로 뒤에 보낸다. <end> 는 늦게 올 수 있어
   "…일치합니다. 大変。" 처럼 다음 사람의 첫 단어나 문장 전체가 앞 카드에 붙었다.
   단방향·양방향 공통: 쉬지 않고 이어 말하면 <end> 가 오지 않아 카드가 760자까지 길어졌다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until, wait } from './helpers/boot.mjs';

const src = (text, language) => ({ text, is_final: true, language, translation_status: 'original' });
const tr = (text, source_language, language) => ({ text, is_final: true, language, source_language, translation_status: 'translation' });

async function setup(t, { query = 'sxMode=two&sxA=ko&sxB=ja', preset = 'twoway', inLang = 'auto' } = {}) {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });
  const cookie = await loginAdmin(srv.base);
  const sess = await fetch(`${srv.base}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: '카드 나누기', pipeline: 'soniox', preset, inLang }),
  }).then((r) => r.json());
  const ws = new WebSocket(`${srv.base.replace('http', 'ws')}/ws/host?src=mic&session=${sess.id}&pipeline=soniox&${query}`, { headers: { Cookie: cookie } });
  const live = [];
  ws.on('message', (d, bin) => { if (!bin) { try { const m = JSON.parse(d.toString()); if (m.type === 'sentence') live.push(m); } catch {} } });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  t.after(() => { try { ws.close(); } catch {} });
  const c = await fake.nextConnection();
  await c.waitConfig;
  const items = async () => (await fetch(`${srv.base}/api/sessions/${sess.id}`, { headers: { Cookie: cookie } }).then((r) => r.json())).items || [];
  const cards = async (n) => {
    await until(async () => (await items()).length === n, { timeout: 6000, desc: `카드 ${n}개` }).catch(async () => assert.fail(`카드가 ${n}개여야 함: ` + JSON.stringify((await items()).map((i) => [i.lang, i.source]))));
    return items();
  };
  return { c, items, cards, live };
}

test('다음 사람의 첫 단어가 <end> 앞에 끼어도 앞 카드에 붙지 않고, 이어지는 말과 합쳐진다', { timeout: 60000 }, async (t) => {
  const { c, cards } = await setup(t);
  c.sendTokens([src('지금은 실제 대기 시간과 거의 일치합니다.', 'ko')]);
  c.sendTokens([tr('今は実際の待機時間とほぼ一致しています。', 'ko', 'ja')]);
  c.sendTokens([src(' 大変。', 'ja')]);
  c.sendTokens([tr(' 정말.', 'ja', 'ko')]);
  c.end();
  await wait(100);
  c.sendTokens([src('参考になりました。', 'ja')]);
  c.sendTokens([tr(' 도움이 됐습니다.', 'ja', 'ko')]);
  c.end();
  const [a, b] = await cards(2);
  assert.equal(a.source, '지금은 실제 대기 시간과 거의 일치합니다.');
  assert.equal(a.lang, 'ko');
  assert.equal(a.texts.ja, '今は実際の待機時間とほぼ一致しています。');
  assert.equal(b.source, '大変参考になりました。', '첫 단어가 제자리로 돌아와야 함');
  assert.equal(b.lang, 'ja');
  assert.equal(b.texts.ko, '정말 도움이 됐습니다.');
});

test('<end> 없이 다음 사람의 문장이 이어져도 언어가 바뀌는 곳에서 카드가 나뉜다', { timeout: 60000 }, async (t) => {
  const { c, items, cards } = await setup(t);
  c.sendTokens([src('덕분에 수하물 분실이 크게 줄었습니다.', 'ko')]);
  c.sendTokens([tr('おかげで手荷物の紛失が大幅に減りました。', 'ko', 'ja')]);
  c.sendTokens([src(' 手荷物搬送システムの処理能力はどのくらいですか。', 'ja')]);
  // <end> 전에 앞 카드가 먼저 확정된다
  await until(async () => (await items()).length === 1, { timeout: 6000, desc: '앞 카드 확정' });
  c.sendTokens([tr(' 수하물 운송 시스템의 처리 능력은 어느 정도인가요?', 'ja', 'ko')]);
  c.sendTokens([src('ピーク時に滞留しませんか。', 'ja')]);
  c.sendTokens([tr(' 혼잡 시간에 밀리지 않나요?', 'ja', 'ko')]);
  c.end();
  const [a, b] = await cards(2);
  assert.equal(a.lang, 'ko');
  assert.equal(a.source, '덕분에 수하물 분실이 크게 줄었습니다.');
  assert.equal(a.texts.ja, 'おかげで手荷物の紛失が大幅に減りました。');
  assert.equal(b.lang, 'ja');
  assert.equal(b.source, '手荷物搬送システムの処理能力はどのくらいですか。ピーク時に滞留しませんか。');
  assert.equal(b.texts.ko, '수하물 운송 시스템의 처리 능력은 어느 정도인가요? 혼잡 시간에 밀리지 않나요?');
});

test('진행 중에도 다음 사람의 말은 앞 카드가 아니라 새 카드에 보인다', { timeout: 60000 }, async (t) => {
  const { c, live } = await setup(t);
  c.sendTokens([src('안내를 마치겠습니다', 'ko')]);
  await until(() => live.some((m) => m.source === '안내를 마치겠습니다'), { timeout: 4000, desc: '앞 카드 표시' });
  const firstId = live.find((m) => m.source === '안내를 마치겠습니다').id;
  c.sendTokens([{ text: 'ありがとう', is_final: false, language: 'ja', translation_status: 'original' }]);
  await until(() => live.some((m) => (m.source || '').includes('ありがとう')), { timeout: 4000, desc: '다음 사람 말 표시' });
  const m = live.find((x) => (x.source || '').includes('ありがとう'));
  assert.notEqual(m.id, firstId, '다른 카드여야 함');
  assert.equal(m.lang, 'ja');
  assert.ok(!live.filter((x) => x.id === firstId).some((x) => (x.source || '').includes('ありがとう')), '앞 카드에 섞이면 안 됨');
});

test('문장 속 외국어 단어는 카드를 나누지 않는다', { timeout: 60000 }, async (t) => {
  const { c, cards } = await setup(t, { query: 'sxMode=two&sxA=ko&sxB=en' });
  c.sendTokens([src('이 서비스의 이름은', 'ko')]);
  c.sendTokens([src(' Smart Pass', 'en')]);
  c.sendTokens([src(' 라고 합니다.', 'ko')]);
  c.sendTokens([tr('This service is called Smart Pass.', 'ko', 'en')]);
  c.end();
  const [a] = await cards(1);
  assert.equal(a.source, '이 서비스의 이름은 Smart Pass 라고 합니다.');
  assert.equal(a.lang, 'ko');
  assert.equal(a.texts.en, 'This service is called Smart Pass.');
});

test('첫 단어만 다른 언어로 잘못 들어와도 카드를 나누지 않는다', { timeout: 60000 }, async (t) => {
  const { c, cards } = await setup(t);
  c.sendTokens([src('네', 'ja')]);
  c.sendTokens([src(', 가능합니다. 수하물은 앱에서 확인합니다.', 'ko')]);
  c.sendTokens([tr('はい、可能です。手荷物はアプリで確認します。', 'ko', 'ja')]);
  c.end();
  const [a] = await cards(1);
  assert.equal(a.lang, 'ko');
  assert.equal(a.source, '네, 가능합니다. 수하물은 앱에서 확인합니다.');
});

test('다음 사람의 짧은 대답 뒤에 말이 이어지지 않으면 그 대답도 잠시 뒤 카드로 남는다', { timeout: 60000 }, async (t) => {
  const { c, cards } = await setup(t);
  c.sendTokens([src('탑승은 1시간 전에 시작합니다.', 'ko')]);
  c.sendTokens([tr('搭乗は1時間前に始まります。', 'ko', 'ja')]);
  c.sendTokens([src(' はい。', 'ja')]);
  c.sendTokens([tr(' 네.', 'ja', 'ko')]);
  c.end();
  const [a, b] = await cards(2);
  assert.equal(a.lang, 'ko');
  assert.equal(b.source, 'はい。', '문장 부호는 그대로');
  assert.equal(b.lang, 'ja');
  assert.equal(b.texts.ko, '네.');
});

test('짧은 대답 뒤에 상대 언어로 말이 이어지면 대답이 먼저 확정된다', { timeout: 60000 }, async (t) => {
  const { c, cards } = await setup(t);
  c.sendTokens([src('탑승은 1시간 전에 시작합니다.', 'ko')]);
  c.sendTokens([tr('搭乗は1時間前に始まります。', 'ko', 'ja')]);
  c.sendTokens([src(' はい。', 'ja')]);
  c.sendTokens([tr(' 네.', 'ja', 'ko')]);
  c.end();
  await wait(100);
  c.sendTokens([src('그리고 수하물은 먼저 맡기세요.', 'ko')]);
  c.sendTokens([tr('そして手荷物は先に預けてください。', 'ko', 'ja')]);
  c.end();
  const [, b, d] = await cards(3);
  assert.equal(b.source, 'はい。');
  assert.equal(b.lang, 'ja');
  assert.equal(d.source, '그리고 수하물은 먼저 맡기세요.');
  assert.equal(d.lang, 'ko');
});

test('앞 카드가 나뉜 뒤 늦게 온 번역 꼬리는 앞 카드로 간다', { timeout: 60000 }, async (t) => {
  const { c, cards, items } = await setup(t);
  c.sendTokens([src('탑승은 1시간 전에 시작합니다.', 'ko')]);
  c.sendTokens([tr('搭乗は', 'ko', 'ja')]);
  c.sendTokens([src(' 手荷物はどこで預けますか。', 'ja')]);
  await until(async () => (await items()).length === 1, { timeout: 6000, desc: '앞 카드 확정' });
  c.sendTokens([tr('1時間前に始まります。', 'ko', 'ja')]);
  c.sendTokens([tr(' 수하물은 어디서 맡기나요?', 'ja', 'ko')]);
  c.end();
  const [a, b] = await cards(2);
  assert.equal(a.texts.ja, '搭乗は1時間前に始まります。');
  assert.equal(b.texts.ko, '수하물은 어디서 맡기나요?');
});

const LONG_KO = '데이터 플랫폼 포털을 통하여 백팔 종의 데이터 융복합 서비스를 제공하고 있으며 이를 바탕으로 공항 운영 전반의 업무 효율을 높이고 있고 앞으로도 전사적인 활용을 위해 계속 노력하겠습니다. 또한 직원 교육과 내부 공모전을 함께 진행하여 실제 현장의 활용 사례를 직접 발굴하고 그 결과를 전사에 공유하겠습니다.';

test('쉬지 않고 이어 말하면 긴 카드는 문장 끝에서 나뉜다(번역이 따라온 뒤)', { timeout: 60000 }, async (t) => {
  const { c, items, cards } = await setup(t, { query: 'sxMode=one&sxTarget=zh&in=ko', preset: 'oneway', inLang: 'ko' });
  c.sendTokens([src(LONG_KO, 'ko')]);
  await wait(300);
  assert.equal((await items()).length, 0, '번역이 오기 전에는 나누지 않는다');
  c.sendTokens([tr('通过数据平台门户提供一百零八种数据融合服务。', 'ko', 'zh')]);
  await until(async () => (await items()).length === 1, { timeout: 6000, desc: '문장 끝에서 확정' });
  c.sendTokens([src('다음입니다.', 'ko')]);
  c.sendTokens([tr('下一个。', 'ko', 'zh')]);
  c.end();
  const [a, b] = await cards(2);
  assert.equal(a.source, LONG_KO);
  assert.equal(a.texts.zh, '通过数据平台门户提供一百零八种数据融合服务。');
  assert.equal(b.source, '다음입니다.');
});

test('긴 카드라도 문장이 안 끝났으면 나누지 않는다', { timeout: 60000 }, async (t) => {
  const { c, items, cards } = await setup(t, { query: 'sxMode=one&sxTarget=zh&in=ko', preset: 'oneway', inLang: 'ko' });
  c.sendTokens([src(LONG_KO.replace(/\.$/, ','), 'ko')]);
  c.sendTokens([tr('通过数据平台门户提供一百零八种数据融合服务，', 'ko', 'zh')]);
  await wait(400);
  assert.equal((await items()).length, 0);
  c.sendTokens([src(' 감사합니다.', 'ko')]);
  c.sendTokens([tr('谢谢。', 'ko', 'zh')]);
  c.end();
  const [a] = await cards(1);
  assert.ok(a.source.endsWith('감사합니다.'));
});
