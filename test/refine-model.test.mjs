/* 관리자 화면의 번역 감수 모델 고르기 — 허용 목록 안에서만 바뀌고, 관리자만 바꿀 수 있다 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, loginAdmin } from './helpers/boot.mjs';

test('감수 모델: 기본값 조회 → 바꾸기 → 허용 목록 밖은 거절 → 로그인 없이는 거절', { timeout: 60000 }, async (t) => {
  const srv = await bootServer({});
  t.after(async () => { await srv.stop(); });
  const cookie = await loginAdmin(srv.base);
  const H = { 'Content-Type': 'application/json', Cookie: cookie };
  const get = () => fetch(`${srv.base}/api/admin/refine-model`, { headers: H }).then((r) => r.json());
  const put = (model, headers = H) => fetch(`${srv.base}/api/admin/refine-model`, { method: 'PUT', headers, body: JSON.stringify({ model }) });

  const first = await get();
  assert.equal(first.model, 'gpt-6.1-terra', '저장된 선택이 없으면 config 기본값');
  assert.deepEqual(first.options.map((o) => o.label), ['TERRA', 'LUNA']);

  const r1 = await put('gpt-6-luna');
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).model, 'gpt-6-luna');
  assert.equal((await get()).model, 'gpt-6-luna', '다시 읽어도 바뀐 값');

  const r2 = await put('gpt-5-nano');
  assert.equal(r2.status, 400, '허용 목록 밖의 모델은 거절');
  assert.equal((await get()).model, 'gpt-6-luna');

  const r3 = await put('gpt-6.1-terra', { 'Content-Type': 'application/json' });
  assert.ok(r3.status === 401 || r3.status === 403, '로그인 없이는 바꿀 수 없다: ' + r3.status);
  assert.equal((await get()).model, 'gpt-6-luna');
});
