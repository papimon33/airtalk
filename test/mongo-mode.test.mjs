/* DB(MongoDB) 모드 회귀 테스트(2026-11-12 보안 점검) — 운영이 쓰는 저장 방식.
   TEST_MONGODB_URI 가 있을 때만 돈다(없으면 건너뜀). 로컬 예:
     docker run -d --rm --name airtalk-test-mongo -p 127.0.0.1:27027:27017 mongo:7
     TEST_MONGODB_URI=mongodb://127.0.0.1:27027 node --test test/mongo-mode.test.mjs
   - 관리자 2단계 인증 설정이 DB 에 저장돼, 서버 디스크가 비워진 뒤(재배포)에도 켜져 있다.
   - 예전 파일(data/security.json)에만 있던 설정은 첫 부팅 때 DB 로 옮겨진다.
   - 세션 저장·삭제가 DB 에 반영되고, 삭제한 세션이 재시작 뒤 되살아나지 않는다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer, loginAdmin, wait } from './helpers/boot.mjs';
import { totpCode } from '../server/util/security_util.js';

const URI = process.env.TEST_MONGODB_URI || '';
const skip = !URI && 'TEST_MONGODB_URI 없음';
const dbName = () => 'airtalk_test_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'airtalk-mongo-'));

async function call(base, method, p, cookie, body) {
  const r = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  return { status: r.status, body: await r.json().catch(() => null), cookie: setCookie.map((c) => String(c).split(';')[0]).join('; ') };
}
const adminLogin = (base, otp) => call(base, 'POST', '/api/login', null, { id: 'admin', password: 'admin', device: 'pc', replace: true, ...(otp ? { otp } : {}) });
const nowCode = (secret) => totpCode(secret, Math.floor(Date.now() / 1000 / 30));

test('DB 모드: 관리자 2단계 인증은 서버 디스크가 비워져도(재배포) 켜져 있다', { skip, timeout: 120000 }, async (t) => {
  const env = { MONGODB_URI: URI, MONGODB_DB: dbName() };
  let srv = await bootServer({ ...env, DATA_DIR: freshDir() });
  t.after(() => srv.stop());
  assert.match(srv.log(), /MongoDB 연결됨/);
  const pc = (await adminLogin(srv.base)).cookie;
  const health = (await call(srv.base, 'GET', '/api/admin/health', pc)).body;
  assert.equal(health.twoFaStore, 'db');
  const setup = await call(srv.base, 'POST', '/api/admin/2fa/setup', pc);
  const ok = await call(srv.base, 'POST', '/api/admin/2fa/verify', pc, { code: nowCode(setup.body.secret) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  await srv.stop();

  // 새(빈) 디스크로 다시 뜬다 — 예전엔 여기서 2단계 인증이 꺼졌다
  srv = await bootServer({ ...env, DATA_DIR: freshDir() });
  assert.equal((await adminLogin(srv.base)).body.need2fa, true, '코드 없이 로그인 불가');
  const again = await adminLogin(srv.base, nowCode(setup.body.secret));
  assert.equal(again.status, 200);
  // 해제도 DB 에 반영된다
  assert.equal((await call(srv.base, 'POST', '/api/admin/2fa/disable', again.cookie, { code: nowCode(setup.body.secret) })).status, 200);
  await srv.stop();
  srv = await bootServer({ ...env, DATA_DIR: freshDir() });
  assert.equal((await adminLogin(srv.base)).status, 200, '해제 뒤에는 코드 없이 로그인');
});

test('DB 모드: 예전 파일에만 있던 2단계 인증 설정은 첫 부팅 때 DB 로 옮겨진다', { skip, timeout: 120000 }, async (t) => {
  // 파일 모드로 켜서 security.json 을 만든다(예전 상태 재현)
  const dir = freshDir();
  let srv = await bootServer({ DATA_DIR: dir });
  t.after(() => srv.stop());
  const pc = (await adminLogin(srv.base)).cookie;
  const setup = await call(srv.base, 'POST', '/api/admin/2fa/setup', pc);
  assert.equal((await call(srv.base, 'POST', '/api/admin/2fa/verify', pc, { code: nowCode(setup.body.secret) })).status, 200);
  await srv.stop();
  assert.ok(fs.existsSync(path.join(dir, 'security.json')));

  const env = { MONGODB_URI: URI, MONGODB_DB: dbName() };
  srv = await bootServer({ ...env, DATA_DIR: dir }); // 파일은 있고 DB 에는 없다 → 옮긴다
  assert.equal((await adminLogin(srv.base)).body.need2fa, true);
  await wait(500);
  await srv.stop();
  srv = await bootServer({ ...env, DATA_DIR: freshDir() }); // 파일이 사라져도 DB 에 남아 있다
  assert.equal((await adminLogin(srv.base)).body.need2fa, true, 'DB 로 옮겨져 유지');
});

test('DB 모드: 세션 저장·삭제가 반영되고, 삭제한 세션은 재시작 뒤 되살아나지 않는다', { skip, timeout: 120000 }, async (t) => {
  const env = { MONGODB_URI: URI, MONGODB_DB: dbName() };
  let srv = await bootServer({ ...env, DATA_DIR: freshDir() });
  t.after(() => srv.stop());
  const admin = await loginAdmin(srv.base);
  const keep = (await call(srv.base, 'POST', '/api/sessions', admin, { title: '남길 세션', pipeline: 'soniox' })).body;
  const gone = [];
  // 저장(400ms 뒤)이 줄 서 있거나 막 도는 여러 시점에 지운다
  for (const gap of [0, 150, 380, 410, 450, 600]) {
    const s = (await call(srv.base, 'POST', '/api/sessions', admin, { title: '지울 세션 ' + gap, pipeline: 'soniox' })).body;
    await wait(gap);
    await call(srv.base, 'PATCH', `/api/sessions/${s.id}`, admin, { title: '고친 제목 ' + gap }); // 저장을 한 번 더 예약
    await wait(gap ? 390 : 0);
    assert.equal((await call(srv.base, 'DELETE', `/api/sessions/${s.id}`, admin)).status, 200);
    gone.push(s.id);
  }
  await wait(1500);
  await srv.stop();
  srv = await bootServer({ ...env, DATA_DIR: freshDir() });
  const admin2 = await loginAdmin(srv.base);
  const logs = (await call(srv.base, 'GET', '/api/admin/logs', admin2)).body;
  const ids = new Set(logs.sessions.map((s) => s.id));
  assert.ok(ids.has(keep.id), '남긴 세션은 DB 에 있다');
  for (const id of gone) assert.ok(!ids.has(id), '삭제한 세션이 되살아나지 않는다: ' + id);
});
