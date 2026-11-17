/* 세션 저장(파일 모드) — SQLite(Node 내장 node:sqlite). MongoDB 를 쓰지 않을 때만 쓴다.
   예전 파일 모드는 발화가 확정될 때마다(0.4초 모아서) 모든 세션을 담은 sessions.json 하나를 통째로 다시 썼다 —
   대화 기록이 쌓일수록 디스크·CPU 를 계속 잡아먹는 구조. 여기서는 세션 하나 = 행 하나라 바뀐 세션만 쓴다.
   · 파일: <DATA_DIR>/airtalk.db (WAL 모드라 -wal·-shm 파일이 함께 생긴다. 백업은 셋을 함께, 또는 서버를 멈추고)
   · 암호화: DATA_KEY 가 있으면 행의 JSON 을 AES-256-GCM 으로 암호화(파일 모드 JSON 과 같은 방식). 평문 행도 읽는다
   · 이전: 표가 비어 있고 sessions.json 이 있으면 첫 부팅에 옮기고 원본은 sessions.json.migrated-<시각> 으로 남긴다
   · 끄기: SESSION_STORE=json 이면 예전 sessions.json 방식. node:sqlite 를 못 쓰는 Node(22.13 미만)도 자동으로 예전 방식 */
import fs from 'fs';
import path from 'path';

// node:sqlite 는 Node 22 에서 '실험 기능' 경고를 한 번 찍는다 — 이 경고만 조용히(다른 경고는 그대로)
let warnFilterInstalled = false;
function quietSqliteWarning() {
  if (warnFilterInstalled) return;
  warnFilterInstalled = true;
  const listeners = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w && w.name === 'ExperimentalWarning' && /SQLite/i.test(String(w.message))) return;
    if (listeners.length) for (const l of listeners) l(w);
    else console.warn(`(node) ${w && w.name}: ${w && w.message}`);
  });
}

export async function openSessionDb(dir, { encrypt, decrypt }) {
  let DatabaseSync;
  try {
    quietSqliteWarning();
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (e) {
    console.warn('[store] node:sqlite 를 쓸 수 없어 sessions.json 방식으로 저장합니다(Node 22.13 이상 필요):', e.message || e);
    return null;
  }
  const file = path.join(dir, 'airtalk.db');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL;
           PRAGMA synchronous = NORMAL;
           PRAGMA busy_timeout = 3000;
           CREATE TABLE IF NOT EXISTS sessions (
             id TEXT PRIMARY KEY,
             doc TEXT NOT NULL,
             updated_at INTEGER NOT NULL
           );`);
  const qAll = db.prepare('SELECT id, doc FROM sessions');
  const qCount = db.prepare('SELECT COUNT(*) AS n FROM sessions');
  const qUpsert = db.prepare('INSERT INTO sessions (id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at');
  const qDelete = db.prepare('DELETE FROM sessions WHERE id = ?');
  const tx = (fn) => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; } };

  return {
    file,
    count: () => Number(qCount.get().n),
    // 행을 읽는다 — 풀 수 없는 행(키 불일치·손상)은 건너뛰고 알려 준다(나머지 세션은 정상으로 뜨게)
    loadAll() {
      const out = [], bad = [];
      for (const r of qAll.all()) {
        try { out.push(JSON.parse(decrypt(r.doc))); } catch (e) { bad.push(r.id); }
      }
      if (bad.length) console.error(`[store] 세션 ${bad.length}개를 읽지 못했습니다(DATA_KEY 확인): ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ' …' : ''}`);
      return out;
    },
    upsert(list) {
      if (!list.length) return;
      const now = Date.now();
      tx(() => { for (const s of list) qUpsert.run(String(s.id), encrypt(JSON.stringify(s)), now); });
    },
    remove(id) { qDelete.run(String(id)); },
    // 표 전체를 지금 목록으로 바꾼다(관리자 전체 초기화처럼 여러 세션을 한꺼번에 지우는 경로)
    replaceAll(list) {
      const now = Date.now();
      tx(() => {
        db.exec('DELETE FROM sessions');
        for (const s of list) qUpsert.run(String(s.id), encrypt(JSON.stringify(s)), now);
      });
    },
    // sessions.json → 표(첫 부팅 한 번). 손상 파일은 예전과 같이 .corrupt-<ts> 로 백업만 하고 넘어간다
    migrateFromJson(jsonFile, readJson) {
      if (!fs.existsSync(jsonFile) || this.count() > 0) return 0;
      let list;
      try { list = JSON.parse(readJson(jsonFile)); } catch (e) {
        const bak = `${jsonFile}.corrupt-${Date.now()}`;
        try { fs.copyFileSync(jsonFile, bak); } catch {}
        console.error(`[store] ${path.basename(jsonFile)} 로드 실패 — 원본을 ${path.basename(bak)} 로 백업 후 빈 상태로 계속`, e.message || e);
        return 0;
      }
      if (!Array.isArray(list)) return 0;
      this.upsert(list.filter((s) => s && s.id));
      try { fs.renameSync(jsonFile, `${jsonFile}.migrated-${Date.now()}`); } catch {}
      console.log(`[store] sessions.json → SQLite 로 세션 ${list.length}개 이전`);
      return list.length;
    },
    close() { try { db.close(); } catch {} },
  };
}
