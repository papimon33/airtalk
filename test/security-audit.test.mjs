/* 보안 점검(2026-11-12) 회귀 테스트 — 가짜 엔진·무과금.
   - 계정 간 격리: 남의 세션은 주소를 알아도 열기·QR·진행자 접속·뷰어 접속이 안 된다(참가 토큰이 있으면 뷰어는 된다).
   - 번역 방식은 세션에 저장된 값만: 접속 주소의 pipeline 값으로 안내데스크 처리를 돌릴 수 없다.
   - 로그인이 끝나면(비밀번호 재설정·로그아웃) 그 로그인으로 열린 연결이 닫히고, 끝난 토큰은 '다른 기기 로그인'으로 바뀌어 읽히지 않는다.
   - 관리자 2단계 인증: 켜져 있으면 덮어쓸 수 없고, 켜면 다른 관리자 기기는 로그아웃, 재시작 뒤에도 유지, 설정을 읽지 못하면 관리자 로그인을 막는다.
   - 관리자 비밀번호를 바꾸면 예전 관리자 로그인이 끝난다.
   - 참여 코드 횟수 제한을 건너뛰는 길(/desk.webmanifest)·뷰어 상한을 건너뛰는 길(role=host)이 막혔다.
   - 용어집 큰 본문은 관리자 확인 뒤에만 읽는다. 세션 제목은 글자만. 다른 출처의 요청·연결은 받지 않는다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, wait, until, viewerToken } from './helpers/boot.mjs';
import { totpCode } from '../server/util/security_util.js';
import { sanitizeTranslation } from '../server/util/pipeline_util.js';
import { clientIp } from '../server/util/net_util.js';

async function call(base, method, p, cookie, body, headers = {}) {
  const r = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  const setCookie = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  return { status: r.status, body: await r.json().catch(() => null), cookie: setCookie.map((c) => String(c).split(';')[0]).join('; ') };
}
const login = (base, id, password, device, replace, otp) => call(base, 'POST', '/api/login', null, { id, password, device, ...(replace ? { replace: true } : {}), ...(otp ? { otp } : {}) });
// 연결 — 열리면 소켓, 거부되면 HTTP 상태 코드
function openWs(url, headers = {}) {
  return new Promise((res) => {
    const ws = new WebSocket(url, { headers });
    ws._msgs = [];
    ws.on('message', (d, bin) => { if (!bin) { try { ws._msgs.push(JSON.parse(d.toString())); } catch {} } });
    ws.once('open', () => res(ws));
    ws.once('unexpected-response', (req, r) => res(r.statusCode));
    ws.once('error', () => res('error'));
  });
}
const wsUrl = (base, p) => base.replace('http', 'ws') + p;
const closed = (ws) => new Promise((res) => { if (ws.readyState === WebSocket.CLOSED) res(-1); else ws.once('close', (code) => res(code)); });
async function twoUsers(base) {
  const admin = await loginAdmin(base);
  await call(base, 'POST', '/api/admin/users', admin, { id: 'kim', password: 'kimpw1' });
  await call(base, 'POST', '/api/admin/users', admin, { id: 'lee', password: 'leepw1' });
  const kim = (await login(base, 'kim', 'kimpw1', 'pc')).cookie;
  const lee = (await login(base, 'lee', 'leepw1', 'pc')).cookie;
  return { admin, kim, lee };
}

test('계정 간 격리: 남의 세션은 열기·QR·진행자 접속·뷰어 접속이 안 되고, 참가 토큰이 있으면 뷰어만 된다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });
  const { base } = srv;
  const { admin, kim, lee } = await twoUsers(base);
  const sess = (await call(base, 'POST', '/api/sessions', kim, { title: '김의 회의', pipeline: 'soniox', preset: 'oneway' })).body;

  // 다른 계정(lee): 주소를 알아도 안 된다
  assert.equal((await call(base, 'GET', `/api/sessions/${sess.id}`, lee)).status, 403, '남의 세션 읽기');
  assert.equal((await call(base, 'GET', `/api/qr?session=${sess.id}`, lee)).status, 403, '남의 세션 QR·참여 코드');
  assert.equal(await openWs(wsUrl(base, `/ws/host?session=${sess.id}&src=mic&sxMode=one&sxTarget=en`), { Cookie: lee }), 403, '남의 세션에 진행자로 접속');
  assert.equal(await openWs(wsUrl(base, `/ws/viewer?session=${sess.id}`), { Cookie: lee }), 403, '남의 세션에 로그인만으로 뷰어 접속');
  assert.equal(await openWs(wsUrl(base, `/ws/viewer?session=${sess.id}&t=0000000000000000`), {}), 403, '틀린 토큰');
  // 없는 세션
  assert.equal(await openWs(wsUrl(base, '/ws/host?session=nope&src=mic'), { Cookie: lee }), 403, '없는 세션에 진행자 접속');
  assert.equal(await openWs(wsUrl(base, '/ws/viewer?session=nope'), { Cookie: lee }), 404, '없는 세션에 뷰어 접속');

  // 주인·관리자는 그대로 된다
  assert.equal((await call(base, 'GET', `/api/sessions/${sess.id}`, kim)).status, 200);
  assert.equal((await call(base, 'GET', `/api/sessions/${sess.id}`, admin)).status, 200, '관리자는 주소로 열 수 있다');
  const host = await openWs(wsUrl(base, `/ws/host?session=${sess.id}&src=mic&sxMode=one&sxTarget=en`), { Cookie: kim });
  assert.ok(host instanceof WebSocket, '주인은 번역 시작: ' + host);
  const own = await openWs(wsUrl(base, `/ws/viewer?session=${sess.id}&role=host`), { Cookie: kim });
  assert.ok(own instanceof WebSocket, '주인 화면의 보기 전용 연결: ' + own);

  // 참가 토큰(QR)이 있으면 누구든 뷰어로는 들어온다 — lee 도 토큰을 받았다면
  const tok = await viewerToken(base, kim, sess.id);
  assert.equal((await call(base, 'GET', `/api/sessions/${sess.id}?t=${tok}`, lee)).status, 200, '토큰으로 읽기');
  const guest = await openWs(wsUrl(base, `/ws/viewer?session=${sess.id}&t=${tok}`), {});
  assert.ok(guest instanceof WebSocket, '토큰으로 뷰어 접속: ' + guest);

  // 뷰어 수: 주소에 role=host 를 붙여도 토큰 뷰어는 뷰어로 센다(상한을 건너뛰지 못한다). 주인의 보기 전용 연결은 세지 않는다
  const sneaky = await openWs(wsUrl(base, `/ws/viewer?session=${sess.id}&t=${tok}&role=host`), {});
  assert.ok(sneaky instanceof WebSocket);
  await until(async () => (await call(base, 'GET', `/api/sessions/${sess.id}/viewers`, kim)).body.n === 2, { desc: '뷰어 수 2(토큰 뷰어 둘, 주인 화면 제외)' });
  for (const w of [host, own, guest, sneaky]) w.close();
});

test('번역 방식은 세션에 저장된 값만: 접속 주소의 pipeline 값으로 안내데스크 처리를 돌릴 수 없다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });
  const { base } = srv;
  const { kim } = await twoUsers(base); // 새 계정은 안내데스크 권한이 없다
  const sess = (await call(base, 'POST', '/api/sessions', kim, { title: '일반 세션', pipeline: 'soniox', preset: 'oneway' })).body;
  const host = await openWs(wsUrl(base, `/ws/host?session=${sess.id}&src=mic&sxMode=one&sxTarget=en&pipeline=desk`), { Cookie: kim });
  assert.ok(host instanceof WebSocket, '접속 자체는 된다(주인): ' + host);
  // 일반 번역이 돈다 — 안내데스크 처리는 손님이 시작하기 전엔 엔진에 붙지 않으므로, 엔진 연결이 생겼다는 것이 그 증거
  const conn = await fake.nextConnection();
  await conn.waitConfig;
  // 안내데스크 처리가 돌지 않았으므로 손님 쪽 시작 요청을 받을 곳이 없다
  const tok = await viewerToken(base, kim, sess.id);
  const guest = await openWs(wsUrl(base, `/ws/viewer?session=${sess.id}&t=${tok}`), {});
  guest.send(JSON.stringify({ type: 'desk-start', lang: 'en', consent: true }));
  await until(() => guest._msgs.some((m) => m.type === 'status' && /준비되지/.test(m.message || '')), { desc: '안내데스크 처리가 없다는 응답' });
  // 여객 마이크 전용 연결도 안내데스크 세션에서만
  const feed = await openWs(wsUrl(base, `/ws/host?session=${sess.id}&src=guestmic`), { Cookie: kim });
  assert.ok(feed instanceof WebSocket);
  await closed(feed);
  // 대화 기록이 응대 기록으로 옮겨지지 않았다
  const got = (await call(base, 'GET', `/api/admin/logs`, await loginAdmin(base))).body;
  assert.ok(!(got.desks || []).some((d) => d.id === sess.id), '안내데스크 기록에 나타나지 않는다');
  for (const w of [host, guest]) w.close();
});

test('로그인이 끝나면 그 로그인으로 열린 연결도 닫히고, 끝난 토큰은 다른 이유로 바뀌어 읽히지 않는다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });
  const { base } = srv;
  const { admin, kim, lee } = await twoUsers(base);
  const sess = (await call(base, 'POST', '/api/sessions', kim, { title: '진행 중', pipeline: 'soniox', preset: 'oneway' })).body;
  const host = await openWs(wsUrl(base, `/ws/host?session=${sess.id}&src=mic&sxMode=one&sxTarget=en`), { Cookie: kim });
  const own = await openWs(wsUrl(base, `/ws/viewer?session=${sess.id}&role=host`), { Cookie: kim });
  const tok = await viewerToken(base, kim, sess.id);
  const guest = await openWs(wsUrl(base, `/ws/viewer?session=${sess.id}&t=${tok}`), {});
  assert.ok(host instanceof WebSocket && own instanceof WebSocket && guest instanceof WebSocket);

  // 관리자가 kim 의 비밀번호를 재설정 → kim 의 로그인으로 열린 연결(진행자·보기 전용)이 닫힌다. 토큰으로 들어온 참가자는 그대로
  const hostClosed = closed(host), ownClosed = closed(own);
  assert.equal((await call(base, 'POST', '/api/admin/users/kim/password', admin, { password: 'kimpw2' })).status, 200);
  assert.equal(await hostClosed, 4401, '진행자 연결 종료');
  assert.equal(await ownClosed, 4401, '보기 전용 연결 종료');
  assert.equal(guest.readyState, WebSocket.OPEN, '참가자(토큰) 연결은 그대로');
  assert.equal(await openWs(wsUrl(base, `/ws/host?session=${sess.id}&src=mic&sxMode=one&sxTarget=en`), { Cookie: kim }), 401, '끝난 쿠키로 다시 붙을 수 없다');

  // 끝난 토큰은 그 뒤 로그인이 몇 번 더 있어도 '비밀번호 변경'으로 남는다(예전엔 replaced 로 바뀌어 재접속 유예 대상이 됐다)
  await login(base, 'kim', 'kimpw2', 'pc');
  await login(base, 'kim', 'kimpw2', 'pc', true);
  assert.deepEqual((await call(base, 'GET', '/api/me', kim)).body, { user: null, reason: 'password' });

  // 로그아웃해도 닫힌다
  const s2 = (await call(base, 'POST', '/api/sessions', lee, { title: '이의 세션', pipeline: 'soniox', preset: 'oneway' })).body;
  const h2 = await openWs(wsUrl(base, `/ws/host?session=${s2.id}&src=mic&sxMode=one&sxTarget=en`), { Cookie: lee });
  assert.ok(h2 instanceof WebSocket);
  const h2Closed = closed(h2);
  await call(base, 'POST', '/api/logout', lee);
  assert.equal(await h2Closed, 4401, '로그아웃 뒤 진행자 연결 종료');
  guest.close();
});

test('관리자 2단계 인증: 덮어쓰기 불가·다른 기기 로그아웃·재시작 뒤 유지·설정을 못 읽으면 로그인 차단', { timeout: 90000 }, async (t) => {
  let srv = await bootServer();
  t.after(() => srv.stop());
  const dataDir = srv.dataDir;
  let { base } = srv;
  const pc = (await login(base, 'admin', 'admin', 'pc', true)).cookie;
  const phone = (await login(base, 'admin', 'admin', 'phone', true)).cookie;
  const nowCode = (secret) => totpCode(secret, Math.floor(Date.now() / 1000 / 30));

  const setup = await call(base, 'POST', '/api/admin/2fa/setup', pc);
  assert.equal(setup.status, 200);
  // 설정을 시작한 로그인이 아니면 확인할 수 없다
  assert.equal((await call(base, 'POST', '/api/admin/2fa/verify', phone, { code: nowCode(setup.body.secret) })).status, 400, '다른 기기에서 확인 불가');
  const ok = await call(base, 'POST', '/api/admin/2fa/verify', pc, { code: nowCode(setup.body.secret) });
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie, '켠 기기는 새 쿠키로 계속');
  // 켜기 전에 로그인해 둔 다른 관리자 기기·옛 쿠키는 끝난다
  assert.equal((await call(base, 'GET', '/api/me', phone)).body.user, null, '다른 관리자 기기 로그아웃');
  assert.equal((await call(base, 'GET', '/api/me', pc)).body.user, null, '옛 쿠키 무효');
  assert.equal((await call(base, 'GET', '/api/me', ok.cookie)).body.user?.id, 'admin');
  // 켜져 있으면 새로 만들 수 없다(현재 코드 없이 바꿔치기 방지)
  assert.equal((await call(base, 'POST', '/api/admin/2fa/setup', ok.cookie)).status, 409, '이미 켜져 있으면 설정 시작 불가');
  // 로그인에 코드가 필요하다
  assert.equal((await login(base, 'admin', 'admin', 'phone', true)).body.need2fa, true);
  assert.equal((await login(base, 'admin', 'admin', 'phone', true, nowCode(setup.body.secret))).status, 200);

  // 재시작 뒤에도 켜져 있다
  await srv.stop();
  srv = await bootServer({ DATA_DIR: dataDir });
  base = srv.base;
  assert.equal((await login(base, 'admin', 'admin', 'phone', true)).body.need2fa, true, '재시작 뒤에도 코드 필요');

  // 설정 파일을 읽을 수 없으면 '꺼짐'으로 넘어가지 않고 관리자 로그인을 막는다
  await srv.stop();
  fs.writeFileSync(path.join(dataDir, 'security.json'), '{ 깨진 파일');
  srv = await bootServer({ DATA_DIR: dataDir });
  base = srv.base;
  const blocked = await login(base, 'admin', 'admin', 'phone', true);
  assert.equal(blocked.status, 503, '설정을 못 읽으면 관리자 로그인 차단');
  assert.equal(blocked.cookie, '');
});

test('관리자 비밀번호를 바꾸면 예전 관리자 로그인이 끝난다(같은 비밀번호로 재시작하면 유지)', { timeout: 90000 }, async (t) => {
  const AUTH_SECRET = 'test-secret-'.repeat(4);
  let srv = await bootServer({ AUTH_SECRET });
  t.after(() => srv.stop());
  const dataDir = srv.dataDir;
  const cookie = await loginAdmin(srv.base);
  await wait(900); // 로그인 자리 저장(디바운스) 대기
  await srv.stop();
  srv = await bootServer({ AUTH_SECRET, DATA_DIR: dataDir });
  assert.equal((await call(srv.base, 'GET', '/api/me', cookie)).body.user?.id, 'admin', '같은 비밀번호로 재시작: 로그인 유지');
  await wait(900);
  await srv.stop();
  srv = await bootServer({ AUTH_SECRET, DATA_DIR: dataDir, ADMIN_PASSWORD: 'admin-new-pw' });
  assert.equal((await call(srv.base, 'GET', '/api/me', cookie)).body.user, null, '비밀번호가 바뀌면 예전 로그인 종료');
});

test('참여 코드 횟수 제한은 /desk.webmanifest 로도 건너뛸 수 없다', { timeout: 60000 }, async (t) => {
  const srv = await bootServer();
  t.after(() => srv.stop());
  const { base } = srv;
  const admin = await loginAdmin(base);
  const sess = (await call(base, 'POST', '/api/sessions', admin, { title: '코드', pipeline: 'soniox', preset: 'oneway' })).body;
  const code = (await call(base, 'GET', `/api/qr?session=${sess.id}`, admin)).body.code;
  assert.equal((await call(base, 'GET', `/api/join/${code}`)).status, 200);
  for (let i = 0; i < 20; i++) {
    const r = await call(base, 'GET', `/desk.webmanifest?code=ZZZZZ${'23456789ABCDEFGHJKMN'[i]}`);
    assert.equal(r.body.start_url, '/desk');
  }
  assert.equal((await call(base, 'GET', `/api/join/${code}`)).status, 429, '틀린 코드 20번 뒤에는 맞는 코드도 잠시 막힌다(제한 공유)');
});

test('입력 확인: 용어집 큰 본문은 관리자 확인 뒤에만 읽고, 세션 제목은 글자만, 긴 ID 는 기록하지 않는다', { timeout: 60000 }, async (t) => {
  const srv = await bootServer();
  t.after(() => srv.stop());
  const { base } = srv;
  const admin = await loginAdmin(base);
  // 로그인하지 않은 큰(깨진) 본문 — 읽기 전에 거절한다(예전엔 16MB 까지 읽고 해석한 뒤 400)
  const big = '{"x":"' + 'a'.repeat(600 * 1024);
  assert.equal((await call(base, 'PUT', '/api/terms-config', null, big)).status, 401, '본문을 읽기 전에 로그인 확인');
  // 관리자는 256KB 를 넘는 용어집도 저장된다
  const cfg = (await call(base, 'GET', '/api/terms-config', admin)).body;
  const up = await call(base, 'PUT', '/api/terms-config', admin, { ...cfg, pad: 'a'.repeat(400 * 1024) });
  assert.equal(up.status, 200, '관리자 큰 용어집 저장: ' + JSON.stringify(up.body).slice(0, 200));
  // 다른 경로는 256KB 한도 그대로
  assert.equal((await call(base, 'POST', '/api/login', null, { id: 'a', password: 'b', pad: 'a'.repeat(300 * 1024) })).status, 413);

  const s1 = (await call(base, 'POST', '/api/sessions', admin, { title: { toString: 1 }, inLang: ['ko'], pipeline: 'soniox' })).body;
  assert.equal(s1.title, '새 세션');
  assert.equal(s1.inLang, 'auto');
  const s2 = (await call(base, 'PATCH', `/api/sessions/${s1.id}`, admin, { title: 12345, inLang: { a: 1 } })).body;
  assert.equal(s2.title, '새 세션');
  assert.equal(s2.inLang, 'auto');
  assert.equal((await call(base, 'PATCH', `/api/sessions/${s1.id}`, admin, { title: '  회의 ' + 'x'.repeat(500) })).body.title.length, 200);
  const logs = (await call(base, 'GET', '/api/admin/logs', admin)).body;
  assert.ok(logs.sessions.every((s) => typeof s.title === 'string'), '관리자 기록의 제목은 모두 글자');

  assert.equal((await login(base, 'x'.repeat(5000), 'pw', 'pc')).status, 401);
  assert.equal((await call(base, 'POST', '/api/admin/users', admin, { id: 'x'.repeat(65), password: 'pw1234' })).status, 400, '계정 ID 길이 상한');
});

test('다른 출처의 요청·연결은 받지 않는다(Origin: null, 대문자 경로, WebSocket)', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });
  const { base } = srv;
  const admin = await loginAdmin(base);
  const sess = (await call(base, 'POST', '/api/sessions', admin, { title: '출처', pipeline: 'soniox', preset: 'oneway' })).body;
  assert.equal((await call(base, 'PATCH', `/api/sessions/${sess.id}`, admin, { title: 'a' }, { Origin: 'null' })).status, 403, 'Origin: null');
  assert.equal((await call(base, 'PATCH', `/API/sessions/${sess.id}`, admin, { title: 'b' }, { Origin: 'https://evil.example' })).status, 403, '대문자 경로');
  assert.equal((await call(base, 'PATCH', `/api/sessions/${sess.id}`, admin, { title: 'c' }, { Origin: base })).status, 200, '같은 출처');
  assert.equal((await call(base, 'PATCH', `/api/sessions/${sess.id}`, admin, { title: 'd' })).status, 200, 'Origin 없는 요청(앱·도구)');
  const hostUrl = wsUrl(base, `/ws/host?session=${sess.id}&src=mic&sxMode=one&sxTarget=en`);
  assert.equal(await openWs(hostUrl, { Cookie: admin, Origin: 'https://evil.example' }), 403, '다른 사이트에서 연 연결');
  const okWs = await openWs(hostUrl, { Cookie: admin, Origin: base });
  assert.ok(okWs instanceof WebSocket, '같은 출처 연결: ' + okWs);
  okWs.close();
});

test('글 처리: 번역문 정리는 긴 공백에도 바로 끝나고, 접속 주소는 프록시 단계 수만큼만 믿는다', () => {
  const t0 = Date.now();
  const out = sanitizeTranslation('안녕하세요' + ' \t'.repeat(40000) + '참고: 의역했습니다');
  assert.ok(Date.now() - t0 < 500, `긴 공백 처리 시간 ${Date.now() - t0}ms`);
  assert.equal(out, '안녕하세요');
  assert.equal(sanitizeTranslation('회의는 3시에  시작합니다. (참고: 직역)'), '회의는 3시에 시작합니다.');
  assert.equal(sanitizeTranslation('첫 줄\n둘째 줄'), '첫 줄\n둘째 줄', '줄바꿈은 그대로');

  const req = (xff, remote) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req('1.1.1.1, 9.9.9.9', '10.0.0.1'), 1), '9.9.9.9', '1단계: 맨 오른쪽 값(프록시가 붙인 값)');
  assert.equal(clientIp(req('6.6.6.6, 1.1.1.1, 9.9.9.9', '10.0.0.1'), 2), '1.1.1.1', '2단계');
  assert.equal(clientIp(req('6.6.6.6', '10.0.0.1'), 0), '10.0.0.1', '프록시 없음: 헤더를 믿지 않는다');
  assert.equal(clientIp(req('', '10.0.0.1'), 1), '10.0.0.1');
});
