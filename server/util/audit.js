/* 접속·관리 로그(2026-11-17) — 보안성 검토 '접속·관리 로그 1년 이상 보관'·관제 연동의 기반.
   한 줄 = JSON 한 건(JSON Lines), 하루 = 파일 하나: <DATA_DIR>/logs/audit-YYYY-MM-DD.jsonl (한국 시각 기준 날짜).
   관제 에이전트(로그 수집기)가 이 폴더를 읽어 가면 된다.
   남기는 것: 로그인 성공·실패·로그아웃, 모든 상태 변경 API(POST·PUT·PATCH·DELETE), 관리자 화면 조회(/api/admin/*),
             번역 시작·종료(호스트 연결: 사용자·세션·파이프라인·사용 시간).
   남기지 않는 것: 요청·응답 본문(비밀번호·대화 내용), 주소의 쿼리 문자열(토큰), 일반 조회와 뷰어 접속(익명·대량).
   보관: AUDIT_RETENTION_DAYS(기본 365일)가 지난 파일은 부팅 때와 하루마다 지운다. 끄기: AUDIT_LOG=0. */
import fs from 'fs';
import path from 'path';
import { DATA_DIR, AUDIT_LOG, AUDIT_RETENTION_DAYS } from '../config.js';
import { kstDay } from './pipeline_util.js';

export const AUDIT_DIR = path.join(DATA_DIR, 'logs');
const FILE_RE = /^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/;
let stream = null;
let streamDay = '';

export function audit(ev, fields = {}) {
  if (!AUDIT_LOG) return;
  try {
    const now = Date.now();
    const day = kstDay(now);
    if (!stream || day !== streamDay) {
      if (stream) stream.end();
      fs.mkdirSync(AUDIT_DIR, { recursive: true });
      stream = fs.createWriteStream(path.join(AUDIT_DIR, `audit-${day}.jsonl`), { flags: 'a' });
      stream.on('error', (e) => console.error('[audit] 기록 실패', e.message || e));
      streamDay = day;
    }
    stream.write(JSON.stringify({ t: new Date(now).toISOString(), ev, ...fields }) + '\n');
  } catch (e) {
    console.error('[audit] 기록 실패', e.message || e);
  }
}

// 보관 기간이 지난 날짜 파일 삭제 — 파일 이름의 날짜(한국 시각) 기준
export function pruneAuditLogs(days = AUDIT_RETENTION_DAYS, now = Date.now()) {
  if (!(days > 0)) return 0;
  let removed = 0;
  try {
    if (!fs.existsSync(AUDIT_DIR)) return 0;
    const cutoff = kstDay(now - days * 86400000);
    for (const f of fs.readdirSync(AUDIT_DIR)) {
      const m = FILE_RE.exec(f);
      if (m && m[1] < cutoff) { fs.unlinkSync(path.join(AUDIT_DIR, f)); removed++; }
    }
  } catch (e) {
    console.error('[audit] 오래된 로그 정리 실패', e.message || e);
  }
  if (removed) console.log(`[audit] 보관 기간(${days}일) 지난 로그 파일 ${removed}개 삭제`);
  return removed;
}

// HTTP 요청 기록 미들웨어 — 응답이 끝난 뒤 한 줄. currentUser 는 순환 참조를 피하려고 주입받는다.
export function auditMiddleware(currentUser) {
  return (req, res, next) => {
    const p = req.path || '';
    if (!AUDIT_LOG || !p.startsWith('/api/')) return next();
    const m = req.method;
    const mutating = m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
    const adminView = p.startsWith('/api/admin/');
    if (!mutating && !adminView) return next();
    const start = Date.now();
    let before = null;
    try { before = currentUser(req); } catch {} // 로그아웃은 응답 뒤엔 사용자를 알 수 없어 미리 본다
    res.on('finish', () => {
      const u = req.user || before;
      const rec = { m, p, st: res.statusCode, ms: Date.now() - start, ip: String(req.ip || '') };
      if (u) { rec.user = u.id; rec.role = u.role; }
      if (p === '/api/login') { // 로그인: 시도한 아이디만(비밀번호 제외)
        rec.loginId = String((req.body && req.body.id) || '').slice(0, 64);
        audit(res.statusCode === 200 ? 'login.ok' : 'login.fail', rec);
        return;
      }
      if (p === '/api/logout') { audit('logout', rec); return; }
      audit(adminView && !mutating ? 'admin.view' : 'api', rec);
    });
    next();
  };
}
