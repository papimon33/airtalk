import { WebSocket } from 'ws';
import { TARGET_LANG, ITEMS_CAP, REFINE_MODEL } from '../config.js';
import { saveSessions, addUsage, recordUsage } from '../store/index.js';
import { getSession } from '../store/sessions.js';
import { getRoom, broadcast, rooms, maybeGcRoom } from './rooms.js';
import { polishText, translateText, retranslateText } from '../vendors/openai.js';
import { translationCut } from '../util/pipeline_util.js';
import { runSoniox } from '../pipelines/soniox.js';
import { runDesk, runDeskGuestFeed } from '../pipelines/desk.js';
import { runTranslate } from '../pipelines/translate.js';

/* ----------------------------- 호스트 ----------------------------- */
/*  pipeline='whisper'  : 전사(gpt-realtime-whisper) -> gpt 번역 (+원어 동봉) */
/*  pipeline='translate': gpt-realtime-translate -> gpt 다듬기                */
export function handleHost(ws) {
  const sessionId = ws._session;
  // 데스크 여객 마이크 공급 전용 연결(2마이크 모드) — 일반 호스트 파이프라인을 타지 않는다
  if (ws._src === 'guestmic') return runDeskGuestFeed(ws);
  const side = ws._src === 'system' || ws._src === 'mic2' ? 'left' : 'right'; // 시스템·상대 마이크(스테레오 R)=좌, 내 마이크=우
  const session = getSession(sessionId);
  // 동시접속 충돌 방지: 같은 세션·같은 소스로 이미 녹음 중인 연결이 있으면 그쪽을 종료하고 새 연결이 승계.
  // (같은 계정으로 다른 기기/탭에서 시작하거나, 새로고침 후 좀비 연결이 남은 경우 — 나중 연결 우선)
  for (const h of [...getRoom(sessionId).hosts]) {
    if (h !== ws && h._src === ws._src) {
      try { h.send(JSON.stringify({ type: 'takeover' })); } catch {}
      try { h.close(); } catch {}
    }
  }
  // room.hosts 에 등록 + 활성 신호(뷰어의 '진행 중' 표시·데스크 가동 여부)
  getRoom(sessionId).hosts.add(ws);
  broadcast(sessionId, { type: 'host', active: true });
  ws.on('close', () => {
    const r = rooms.get(sessionId);
    if (r) {
      r.hosts.delete(ws);
      if (r.hosts.size === 0) broadcast(sessionId, { type: 'host', active: false });
    }
    maybeGcRoom(sessionId);
  });
  // 사용량 집계: 호스트 WS 연결 시간 → 사용자별 누적 + 파이프라인별 일별 비용.
  // 데스크는 예외 — 대기(idle)는 STT 미연결(비용 0)이므로 실제 통역(active) 시간만 집계.
  const usageStart = Date.now();
  ws.on('close', () => {
    const ms = pipeline === 'desk'
      ? (ws._deskActiveMs || 0) + (ws._deskActiveStart ? Date.now() - ws._deskActiveStart : 0)
      : Date.now() - usageStart;
    addUsage(ws._userId, ms);
    recordUsage(pipeline, ms); // pipeline 은 아래에서 정의됨(close 시점엔 초기화 완료)
  });
  // 유휴 자동 종료: 1분간 음성 활동(전사/번역 델타)이 없으면 OA 세션을 닫아 비용 절감.
  const IDLE_LIMIT_MS = 60000;
  let idleTimer = null;
  // 파이프라인 모듈(pipelines/*)과 공유하므로 객체로 둔다(구 idleClose/idleStopped 지역 변수)
  const idle = { close: null, stopped: false }; // close: 파이프라인이 OA 종료 함수를 등록
  function bumpIdle() {
    if (idle.stopped) return;
    if (pipeline === 'desk') return; // 데스크: 대기 모드는 무기한 유지(통역 중 종료는 deskIdle 로 별도 처리)
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idle.stopped = true;
      toHost({ type: 'idle-stop' });
      toHost({ type: 'status', message: '1분간 입력이 없어 번역을 중지했습니다.' });
      if (idle.close) try { idle.close(); } catch {}
    }, IDLE_LIMIT_MS);
  }
  ws.on('close', () => clearTimeout(idleTimer));
  // 클라이언트가 보내는 소리 감지(VAD) 신호로도 유휴 타이머 리셋 →
  // 시스템 오디오 등 '말(전사)'이 아닌 소리가 들어와도 중지되지 않음.
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    try {
      if (JSON.parse(data.toString()).type === 'activity') bumpIdle();
    } catch {}
  });
  const inRaw = ws._in != null ? ws._in : session ? session.inLang : null;
  const inLang = inRaw && inRaw !== 'auto' ? inRaw : null;
  const pipeline = ws._pipeline || (session && session.pipeline) || 'whisper';
  // 출력 언어 목록: whisper 는 다국어, translate 는 1개
  const sessionLangs =
    session && Array.isArray(session.langs) && session.langs.length
      ? session.langs
      : [ws._out || (session && session.outLang) || TARGET_LANG];
  const targetLang = sessionLangs[0]; // translate 파이프라인용 단일 언어

  const toHost = (obj) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };
  const sendPartial = (text) => {
    const p = { type: 'partial', side, text };
    toHost(p);
    broadcast(sessionId, p);
  };
  // 문장 항목: texts = { 언어코드: 번역문 }. 같은 id 로 여러 번 호출하면 언어별로 병합됨.
  // lang = 발화(원문) 언어 — 데스크 뷰어가 말풍선 좌우(안내원/손님)를 번역 도착 전에 판단하는 데 사용.
  // sideOv = 채널별 side 오버라이드(데스크 여객 마이크 채널='left', 기본은 이 연결의 소스 기준).
  const buildMsg = (id, item) => ({ type: 'sentence', id, side: item.side || side, source: item.source || null, texts: item.texts, speaker: item.speaker || null, ...(item.lang ? { lang: item.lang } : {}), ...(item.toks ? { toks: item.toks } : {}) });
  // 화면에만 보냄(저장 안 함) — translate 스트리밍/whisper 진행표시용
  // draft:true — 아직 확정되지 않은(엔진이 <end> 를 주기 전) 진행 중 발화·번역이라는 표시.
  // 클라는 이걸 흐리게 그리고, 확정 시 buildMsg 가 draft 없이 같은 id 를 다시 보내면 또렷해진다.
  // 다듬기(polish)까지 끝나도 같은 경로(upsertItem→buildMsg)라 확정 표시가 유지된다.
  // 구버전 캐시 클라(desk.html 태블릿)는 이 필드를 무시하므로 지금과 똑같이 그려진다 — 추가는 안전.
  const liveSend = (id, langTexts, source, speaker, lang, sideOv) => {
    const m = { type: 'sentence', id, side: sideOv || side, source: source || null, texts: langTexts, speaker: speaker || null, ...(lang ? { lang } : {}), draft: true };
    toHost(m);
    broadcast(sessionId, m);
  };
  // 확정: 세션 저장 + 전송. 언어별로 병합.
  // toks = 원문 STT 토큰 [[text, confidence], ...] — 저신뢰 단어 하이라이트 + 추후 인식 품질 평가용 기록
  const upsertItem = (id, langTexts, source, speaker, lang, sideOv, toks, tm) => {
    const toksCapped = Array.isArray(toks) && toks.length ? toks.slice(0, 120) : null;
    let item;
    if (session) {
      item = session.items.find((x) => x.id === id);
      if (item) {
        item.texts = { ...(item.texts || {}), ...langTexts };
        if (source) item.source = source;
        if (speaker) item.speaker = speaker;
        if (lang) item.lang = lang;
        if (toksCapped) item.toks = toksCapped;
        if (tm) item.tm = { ...(item.tm || {}), ...tm };
      } else {
        item = { id, side: sideOv || side, source: source || null, texts: { ...langTexts }, speaker: speaker || null, ...(lang ? { lang } : {}), ...(toksCapped ? { toks: toksCapped } : {}), ...(tm ? { tm: { ...tm } } : {}) };
        session.items.push(item);
        if (session.items.length > ITEMS_CAP) session.items.splice(0, session.items.length - ITEMS_CAP);
      }
      if (session.title === '새 세션' && session.items.length === 1) {
        const first = Object.values(item.texts)[0] || '';
        if (first) session.title = first.slice(0, 40);
      }
      session.updatedAt = Date.now();
      saveSessions(session.id);
    } else {
      // 세션이 삭제된 뒤에도 채널 귀속(side/lang)이 유지되도록 폴백에도 오버라이드 반영
      item = { id, side: sideOv || side, source: source || null, texts: { ...langTexts }, ...(lang ? { lang } : {}), ...(toksCapped ? { toks: toksCapped } : {}) };
    }
    toHost(buildMsg(id, item));
    broadcast(sessionId, buildMsg(id, item));
  };

  // 번역 다듬기 컨텍스트: 직전 확정 발화(타깃 언어 기준) 최대 3건 — 단답("처음부터요") 자연화에 필수
  const polishCtx = (key, excludeId) => {
    if (!session || !Array.isArray(session.items)) return '';
    const rows = [];
    for (let i = session.items.length - 1; i >= 0 && rows.length < 3; i--) {
      const it = session.items[i];
      if (!it || it.id === excludeId) continue;
      const t = (it.texts && (it.texts[key] || Object.values(it.texts)[0])) || it.source;
      if (t) rows.unshift(String(t).slice(0, 120));
    }
    return rows.join('\n');
  };
  // 확정 카드 감수(다듬기): 비동기 → 카드가 살아 있고 텍스트가 그대로일 때만 덮어쓰기
  // (그 사이 늦은 번역 꼬리가 먼저 덮었으면 양보). 응대 종료로 deskLog 에
  // 아카이브된 뒤 도착하면 기록만 조용히 갱신(뷰어 방송 불필요).
  const findItem = (id) => (session && Array.isArray(session.items) ? session.items.find((x) => x.id === id) : null);
  const applyPolish = (id, key, base) => (out) => {
    if (!out) return;
    const it = findItem(id);
    if (it && it.texts && it.texts[key] === base) { upsertItem(id, { [key]: out }); return; }
    if (session && Array.isArray(session.deskLog)) {
      for (let i = session.deskLog.length - 1; i >= 0 && i >= session.deskLog.length - 2; i--) {
        const e = session.deskLog[i];
        const a = e && Array.isArray(e.items) ? e.items.find((x) => x.id === id) : null;
        if (a && a.texts && a.texts[key] === base) { a.texts[key] = out; saveSessions(session.id); return; }
      }
    }
  };
  const polishCommit = (id, key, src, tgt) => {
    if (translationCut(src, tgt)) {
      // 엔진 번역이 중간에 끊긴 듯하다 — 확정 직후엔 번역 꼬리가 늦게 붙기도 하므로 잠깐 기다린 뒤 다시 보고,
      // 그래도 끊겨 있으면 원문 전체를 다시 번역한다(다듬기는 빠진 내용을 채우지 않는다)
      setTimeout(() => {
        const it = findItem(id);
        const cur = (it && it.texts && it.texts[key]) || tgt;
        const job = translationCut(src, cur) ? retranslateText(src, key, polishCtx(key, id), cur) : polishText(src, cur, key, polishCtx(key, id));
        job.then(applyPolish(id, key, cur)).catch(() => {});
      }, 2500);
      return;
    }
    polishText(src, tgt, key, polishCtx(key, id)).then(applyPolish(id, key, tgt)).catch(() => {});
  };

  // 파이프라인 모듈에 넘기는 연결 컨텍스트 — 구 server.js 에선 run*() 이 handleHost 안의 중첩 함수로 이 값들을 클로저로 공유했다
  const h = { ws, sessionId, session, pipeline, inLang, targetLang, idle, toHost, liveSend, upsertItem, polishCommit, bumpIdle };
  if (pipeline === 'translate') runTranslate(h);
  else if (pipeline === 'soniox') runSoniox(h);
  else if (pipeline === 'desk') runDesk(h);
  // whisper(구 다국어 번역) 파이프라인은 지원 종료 — 기존 세션 기록은 열람만 가능
  else toHost({ type: 'status', message: '이 세션의 번역 모드(다국어 번역·구)는 지원이 종료되었습니다. 새 세션을 만들어 이용해 주세요.' });
}
