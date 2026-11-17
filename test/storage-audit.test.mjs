/* 파일 모드 저장(SQLite)·대화 기록 보관 기간·접속·관리 로그 (가짜 엔진, 무과금) */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { bootServer, loginAdmin, until, readStoredSessions } from './helpers/boot.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const json = (cookie) => ({ headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } });
const DAY = 86400000;
const idAt = (ms) => ms.toString(36) + 'abcde'; // newId 형식(36진수 시각 + 난수 5자리)

test('SQLite: 세션이 airtalk.db 에 저장되고, 재시작 뒤 다시 읽히며, 삭제·전체 초기화가 표에 반영된다', { timeout: 90000 }, async (t) => {
  const dir = tmp('airtalk-sqlite-');
  let srv = await bootServer({ DATA_DIR: dir });
  let cookie = await loginAdmin(srv.base);
  const mk = (title, extra = {}) => fetch(`${srv.base}/api/sessions`, { method: 'POST', ...json(cookie), body: JSON.stringify({ title, pipeline: 'soniox', preset: 'oneway', ...extra }) }).then((r) => r.json());
  const a = await mk('남길 세션'), b = await mk('지울 세션');
  const desk = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...json(cookie), body: JSON.stringify({ title: '데스크', pipeline: 'desk' }) }).then((r) => r.json());
  await until(() => (readStoredSessions(dir) || []).length === 3, { desc: '세션 3개 저장' });
  assert.ok(fs.existsSync(path.join(dir, 'airtalk.db')));
  assert.ok(!fs.existsSync(path.join(dir, 'sessions.json')), '예전 통째 파일은 만들지 않는다');

  await fetch(`${srv.base}/api/sessions/${b.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  await srv.stop();
  srv = await bootServer({ DATA_DIR: dir });
  t.after(() => srv.stop());
  cookie = await loginAdmin(srv.base);
  const list = await fetch(`${srv.base}/api/sessions`, { headers: { Cookie: cookie } }).then((r) => r.json());
  const titles = (Array.isArray(list) ? list : list.sessions || []).map((s) => s.title).sort();
  assert.ok(titles.includes('남길 세션') && !titles.includes('지울 세션'), '재시작 뒤 목록: ' + titles.join(','));

  // 전체 초기화: 데스크 세션만 남고 나머지 행은 표에서도 사라진다
  const r = await fetch(`${srv.base}/api/admin/reset-all`, { method: 'POST', ...json(cookie), body: JSON.stringify({ password: 'admin' }) });
  assert.equal(r.status, 200);
  const stored = readStoredSessions(dir).map((s) => s.id);
  assert.deepEqual(stored, [desk.id], '표에는 데스크 세션만: ' + stored.join(','));
  assert.ok(!stored.includes(a.id));
});

test('SQLite: DATA_KEY 가 있으면 행이 암호화되어 디스크에 제목이 평문으로 남지 않는다', { timeout: 60000 }, async (t) => {
  const dir = tmp('airtalk-sqlite-enc-');
  const srv = await bootServer({ DATA_DIR: dir, DATA_KEY: 'test-data-key-0123456789' });
  t.after(() => srv.stop());
  const cookie = await loginAdmin(srv.base);
  await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...json(cookie), body: JSON.stringify({ title: '비밀회의XYZ', pipeline: 'soniox', preset: 'oneway' }) });
  await new Promise((r) => setTimeout(r, 1200));
  const raw = fs.readdirSync(dir).filter((f) => f.startsWith('airtalk.db')).map((f) => fs.readFileSync(path.join(dir, f))).map((b) => b.toString('utf8')).join('');
  assert.ok(raw.length > 0);
  assert.ok(!raw.includes('비밀회의XYZ'), '제목이 평문으로 보이면 안 됨');
});

test('보관 기간: TRANSCRIPT_RETENTION_DAYS 보다 오래된 문장·응대 기록만 부팅 때 지우고, 세션은 남긴다', { timeout: 60000 }, async (t) => {
  const dir = tmp('airtalk-retention-');
  const now = Date.now(), old = now - 40 * DAY, recent = now - 2 * DAY;
  fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify([
    { id: 's1', owner: 'admin', title: '회의', pipeline: 'soniox', preset: 'oneway', src: 'mic', createdAt: old, updatedAt: recent, items: [
      { id: 'x1', side: 'right', source: '옛 문장(tm)', texts: {}, tm: { s: old, c: old } },
      { id: idAt(old), side: 'right', source: '옛 문장(id)', texts: {} },
      { id: idAt(recent), side: 'right', source: '최근 문장', texts: {} },
      { id: 'zz', side: 'right', source: '시각 모름(세션 갱신 시각 기준 — 최근)', texts: {} },
    ] },
    { id: 'd1', owner: 'admin', title: '데스크', pipeline: 'desk', createdAt: old, updatedAt: old, items: [], deskLog: [
      { startedAt: old, endedAt: old + 60000, lang: 'en', items: [{ id: 'a', source: 'old' }] },
      { startedAt: recent, endedAt: recent + 60000, lang: 'ja', items: [{ id: 'b', source: 'new' }] },
    ] },
  ]));
  const srv = await bootServer({ DATA_DIR: dir, TRANSCRIPT_RETENTION_DAYS: '30' });
  t.after(() => srv.stop());
  let stored;
  await until(() => { stored = readStoredSessions(dir); return stored && stored.find((s) => s.id === 's1')?.items.length === 2; }, { desc: '오래된 문장 삭제 저장' });
  const s1 = stored.find((s) => s.id === 's1'), d1 = stored.find((s) => s.id === 'd1');
  assert.deepEqual(s1.items.map((i) => i.source), ['최근 문장', '시각 모름(세션 갱신 시각 기준 — 최근)']);
  assert.deepEqual(d1.deskLog.map((d) => d.lang), ['ja'], '응대 기록도 기간 기준');
  assert.equal(stored.length, 2, '세션 자체는 남긴다');
});

test('접속·관리 로그: 로그인 성공·실패·상태 변경·관리자 조회·번역 시작/종료를 남기고, 비밀번호는 남기지 않는다. 오래된 파일은 지운다', { timeout: 60000 }, async (t) => {
  const dir = tmp('airtalk-audit-');
  fs.mkdirSync(path.join(dir, 'logs'));
  fs.writeFileSync(path.join(dir, 'logs', 'audit-2020-01-01.jsonl'), '{}\n'); // 보관 기간(365일) 지난 파일
  const srv = await bootServer({ DATA_DIR: dir });
  t.after(() => srv.stop());
  assert.ok(!fs.existsSync(path.join(dir, 'logs', 'audit-2020-01-01.jsonl')), '오래된 로그 파일 삭제');

  const bad = await fetch(`${srv.base}/api/login`, { method: 'POST', ...json(), body: JSON.stringify({ id: 'admin', password: 'WRONG-pass-777' }) });
  assert.notEqual(bad.status, 200);
  const cookie = await loginAdmin(srv.base);
  const s = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...json(cookie), body: JSON.stringify({ title: '로그', pipeline: 'soniox', preset: 'oneway' }) }).then((r) => r.json());
  await fetch(`${srv.base}/api/admin/users`, { headers: { Cookie: cookie } });
  await fetch(`${srv.base}/api/sessions`, { headers: { Cookie: cookie } }); // 일반 조회는 남기지 않음
  const host = new WebSocket(`${srv.base.replace('http', 'ws')}/ws/host?session=${s.id}&src=mic&pipeline=soniox&sxMode=one&sxTarget=en&in=ko`, { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { host.once('open', res); host.once('error', rej); });
  host.close();

  const read = () => fs.readdirSync(path.join(dir, 'logs')).filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => fs.readFileSync(path.join(dir, 'logs', f), 'utf8').split('\n').filter(Boolean));
  let lines = [];
  await until(() => { lines = read(); return lines.some((l) => l.includes('"host.close"')); }, { desc: '번역 종료 기록' });
  const recs = lines.map((l) => JSON.parse(l));
  const ev = (e) => recs.filter((r) => r.ev === e);
  assert.ok(ev('server.start').length >= 1);
  assert.ok(ev('login.fail').some((r) => r.loginId === 'admin' && r.st !== 200 && r.ip), '로그인 실패(아이디·IP)');
  assert.ok(ev('login.ok').some((r) => r.loginId === 'admin'), '로그인 성공');
  assert.ok(ev('api').some((r) => r.m === 'POST' && r.p === '/api/sessions' && r.user === 'admin' && r.st === 200), '세션 생성');
  assert.ok(ev('admin.view').some((r) => r.p === '/api/admin/users'), '관리자 조회');
  assert.ok(!recs.some((r) => r.m === 'GET' && r.p === '/api/sessions'), '일반 조회는 남기지 않음');
  assert.ok(ev('host.open').some((r) => r.session === s.id && r.user === 'admin'), '번역 시작');
  assert.ok(ev('host.close').some((r) => r.session === s.id && typeof r.ms === 'number'), '번역 종료·사용 시간');
  const all = lines.join('\n');
  assert.ok(!all.includes('WRONG-pass-777') && !/"password"/.test(all), '비밀번호는 기록하지 않는다');
});
