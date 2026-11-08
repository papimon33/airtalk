/* 파이프라인 순수 로직 유틸 — server.js 에서 분리(security_util.js 와 동일 패턴).
   목적: 상태(세션·소켓·termsConfig)에 묶이지 않은 판정/정제 함수를 테스트에서 직접 임포트할 수 있게.
   여기 함수들은 부작용이 없어야 한다(파일·네트워크·전역 상태 접근 금지). */

/* ── KST 일자 버킷 ── */
export const kstDay = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

/* ── 간투사(음/어/uh)·단독 응답어 필터 ── */
const FILLER_NOISE_RE = /\b(?:u+m+|u+h+|uh+m+|hm+|mm+|mhm|e+r+m*|o+h+|a+h+|h+u+h+)\b|(?<![가-힣])(?:음+|어+|아+|으+음*|앗|핫|헉|흠+)(?![가-힣])|(?:え[ーっ]?と|えー+|あー+|うー+|んー+)|(?:嗯+|呃+|唔+)/gi;
// 소프트 간투사: 영어 yeah/yep/yup/y'know (발화 전체면 보존). 'well'은 실단어 의미가 있어 제외.
const FILLER_SOFT_RE = /\b(?:yeah|yep|yup|y'?know)\b/gi;
// 전체 발화 전용 잡음: 문장 중간에선 실단어일 수 있어 못 지우지만, '발화 전체'가 이것뿐이면 잡음 확정.
// (일본어 단독 あ/え/ん, 중국어 단독 啊/哦/唉 — 가나·한자 단어 내부에 흔해 부분 제거는 위험)
const FILLER_WHOLE_RE = /^(?:あ+|え+|ん+|は+ぁ*|啊+|哦+|唉+|嗯+)[\s。、.,!?！？…~〜]*$/;
// 단독 응답어(ACK): "네./Yes./Okay." 류 실제 대답 — 기본은 보존.
// 고급옵션 '단독 응답어 생략'을 켠 세션에서만 기록에서 제외(회의록 간소화용).
// 주의: 정보성 단답과 겹치는 단어는 넣지 않는다 — 'right'(방향 안내 "오른쪽입니다"),
// '글쎄요'(유보 의사 표시)는 생략되면 실질 내용이 유실돼 제외했다.
const ACK_WORDS = new Set([
  '네', '예', '넵', '응', '그래', '그래요', '맞아', '맞아요', '맞습니다', '알겠습니다', '알겠어요', '좋아요', '좋습니다',
  '아니', '아니요', '아니오', '아뇨',
  'yes', 'yeah', 'yep', 'no', 'nope', 'okay', 'ok', 'sure', 'alright', 'exactly', 'correct',
  'はい', 'ええ', 'いいえ', 'うん', 'そう', 'そうです', 'わかりました',
  '是', '是的', '好', '好的', '对', '不是', '不',
]);
export const isAckOnly = (text) => {
  const n = String(text || '').toLowerCase().replace(/[\s。、.,!?！？…~〜'"]+/g, '');
  return !!n && ACK_WORDS.has(n);
};
function cleanFillerSpacing(s) {
  return String(s)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?。、！？…])/g, '$1')       // 구두점 앞 공백 제거
    .replace(/([,、])\s*(?=[,、])/g, '')            // 연속 쉼표 정리
    .replace(/^[\s,.、。，！？!?：；…·\-]+/, '')       // 앞쪽에 남은 구두점/공백 제거(전각 포함)
    .replace(/\s{2,}/g, ' ')
    .trim();
}
export function stripFillers(text) {
  const original = String(text == null ? '' : text);
  if (!original.trim()) return original;
  if (FILLER_WHOLE_RE.test(original.trim())) return ''; // 발화 전체가 잡음(단독 あ/啊 등) → 카드째 드롭
  let s = original.replace(FILLER_NOISE_RE, ' ');       // ① 순수 잡음 — 항상 제거
  const soft = s.replace(FILLER_SOFT_RE, ' ');          // ② 소프트 간투사 — 내용이 남을 때만
  if (/[\p{L}\p{N}]/u.test(cleanFillerSpacing(soft))) s = soft;
  s = cleanFillerSpacing(s);
  if (/^[a-z]/.test(s)) s = s[0].toUpperCase() + s.slice(1); // 앞 간투사 제거로 소문자 시작이면 첫 글자 복원
  return s;
}

/* ── 다듬기 결과가 목표 언어 글자로 쓰였나 ──
   모델이 가끔 원문 언어(한국어)로 고쳐 쓰거나 중국어를 번체자로 내놓는다(2026-10-28 발표 한→중 테스트에서 확인).
   기계 번역에 없던 한글이 생기거나(목표가 한국어가 아닐 때), 중국어인데 번체 전용 글자가 생기면 다듬기를 버린다. */
const HANGUL = /[\uAC00-\uD7A3]/;
const ZH_TRAD = /[這們個說會對為與關於運營報內開發業務數據機場資訊處現進過還讓統點體號時間長門東車電話經實際從後當種樣檢區國標準輸繼續認識讀寫導應]/;
/* 다듬기 결과 길이 검사: 해설이 섞여 크게 늘었거나, 내용이 빠져 크게 줄었으면 기계 번역을 유지한다.
   짧은 문장은 자연스럽게 고치면서 많이 줄 수 있으니(31자 → 18자) 40자 이상일 때만 줄어든 비율을 본다. */
export function polishLengthOk(out, raw) {
  if (out.length > raw.length * 3 + 20) return false;
  return raw.length < 40 || out.length >= raw.length * 0.6;
}

export function langScriptOk(out, raw, lang) {
  const s = String(out || ''), r = String(raw || '');
  if (lang !== 'ko' && HANGUL.test(s) && !HANGUL.test(r)) return false;
  if (lang === 'zh' && ZH_TRAD.test(s) && !ZH_TRAD.test(r)) return false;
  return true;
}

/* ── GPT 번역 출력 정제 ── */
export function sanitizeTranslation(out) {
  let s = String(out || '').trim();
  if (!s) return '';
  // 코드블록 제거
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim();
  // 문두 머리말 제거: "…(옮기면/번역하면) 다음과 같습니다:" 류 접두를 통째로 잘라냄
  s = s.replace(/^[^\n]*?다음과\s*같습니다\s*[:：.]?\s*/, '');
  // 화살표(원문 → 번역) 형식이면 화살표 뒤(번역)만 취함
  if (/→|->/.test(s)) {
    s = s
      .split(/\n+/)
      .map((ln) => {
        const parts = ln.split(/\s*(?:→|->)\s*/);
        return parts.length > 1 ? parts[parts.length - 1] : ln;
      })
      .join('\n');
  }
  const DROP = /^\s*(?:참고|제안|주의|노트|note)\s*[:：]/i; // 줄 전체가 메타면 버림
  const META_TAIL = /\s*[\(（]?\s*(?:참고|제안|주의|노트|note)\s*[:：].*$/i; // 줄 중간부터 시작하는 메타(괄호 포함) 꼬리 제거
  const lines = s
    .split(/\n+/)
    .map((ln) => ln.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()) // 불릿/번호 제거
    .map((ln) => (DROP.test(ln) ? '' : ln.replace(META_TAIL, '').trim()))
    .filter(Boolean);
  s = lines.join('\n').trim();
  // 끝에 붙는 메타 괄호주석(번역/의역/정중체 등 키워드 포함)만 제거
  s = s.replace(/\s*[\(（][^)）]*(번역|의역|정중체|매끄럽|자연스럽|문장\s*단위|note|참고)[^)）]*[\)）]\s*$/i, '').trim();
  return s;
}

/* ── 공개 뷰어의 데스크 제어(desk-start/end/mic) 남용 가드 ──
   start/end/mic 는 유료 엔진 체결(context 재과금)을 직접 유발하므로 소켓당·세션당 분당 횟수 제한 +
   start/end 는 세션당 0.8초 간격. 정상 손님 조작(언어 선택, 종료 후 재선택, 재접속 시 desk-mic
   재동기화)은 걸리지 않는 수준. micOnly=true 면 간격 제한 제외.
   holder(ws/room)에 _deskCtl 상태를 기록한다 — now 주입으로 테스트 가능. */
export function deskCtlAllowed(ws, room, micOnly, now = Date.now()) {
  const bump = (holder, max) => {
    let st = holder._deskCtl;
    if (!st || now - st.t > 60000) st = holder._deskCtl = { t: now, n: 0 };
    return ++st.n <= max;
  };
  if (!bump(ws, 20)) return false;
  if (room) {
    if (!bump(room, 40)) return false;
    if (!micOnly) {
      if (now - (room.lastDeskStartEnd || 0) < 800) return false;
      room.lastDeskStartEnd = now;
    }
  }
  return true;
}

/* 발화 언어 판정(양방향·채널 분리 공용). 예전엔 응답마다 비확정 토큰까지 다시 세서, 초기 오판(일본어 'スマートフォン…'을
   처음엔 한국어 '스마트폰…'으로 들음)이 수십 번 반복 집계돼 확정된 정답을 이겼다 — 카드가 '한국어 발화'로 저장되고 번역 칸(ja)에
   한국어 문장이 들어가 뷰어에 뒤집혀 보였다(2026-10-21 모노 양방향 측정에서 재현).
   우선순위: ① 확정 번역 토큰의 source_language — 엔진이 실제로 번역한 방향이라 카드의 번역 칸과 항상 맞는다
   ② 확정 원문 토큰 다수결 ③ 아직 확정이 없으면 이번 응답의 비확정 토큰 다수결(누적하지 않음). 동률이면 직전 판정 유지. */
export function langJudge() {
  let votes = {}, trVotes = {}, resp = {};
  const lg = (x) => (x ? String(x).split('-')[0].toLowerCase() : '');
  const lead = (m, prev) => { let best = prev && m[prev] ? prev : ''; for (const k of Object.keys(m)) if (!best || m[k] > (m[best] || 0)) best = k; return best; };
  return {
    reset() { votes = {}; trVotes = {}; resp = {}; },
    begin() { resp = {}; }, // 응답 하나 시작 — 비확정 토큰은 응답마다 다시 오므로 그 응답 안에서만 센다
    token(t) {
      // 번역 토큰은 글자 수로 센다. 마지막 값을 믿으면 다음 사람의 첫 단어가 카드 끝에 붙었을 때
      // 카드 전체의 언어가 그 단어를 따라 뒤집힌다(v6 에서 "…일치합니다. 大変。" 이 일본어 카드가 됨)
      if (t.translation_status === 'translation') { if (t.is_final && t.source_language) { const k = lg(t.source_language); trVotes[k] = (trVotes[k] || 0) + [...String(t.text || '')].length; } return; }
      const l = lg(t.language);
      if (!l) return;
      if (t.is_final) votes[l] = (votes[l] || 0) + 1; else resp[l] = (resp[l] || 0) + 1;
    },
    pick(prev) {
      if (Object.keys(trVotes).length) return lead(trVotes, prev);
      if (Object.keys(votes).length) return lead(votes, prev);
      if (Object.keys(resp).length) return lead(resp, prev);
      return prev;
    },
  };
}

/* 말의 양 — 한글·한자·가나는 글자 하나가 1, 라틴 문자는 단어 길이가 길어 0.4 로 센다(부호·공백 제외). */
export const speechWeight = (s) => {
  let w = 0;
  for (const c of String(s || '').match(/[\p{L}\p{N}]/gu) || []) w += c.charCodeAt(0) < 128 ? 0.4 : 1;
  return w;
};
const SENT_END_RE = /[.!?。！？…]["'”’)\]]*\s*$/;
export const endsSentence = (s) => SENT_END_RE.test(String(s || ''));
export const stripSentenceEnd = (s) => String(s || '').replace(/[.!?。！？…]+\s*$/, '');

const FLIP_MIN_CARD = 4;   // 앞 카드의 말이 이보다 적으면 첫 단어 오인식일 수 있어 나누지 않는다(다수결이 바로잡음)
const FLIP_READY = 12;     // 문장이 안 끝나도 이만큼 이어지면 문장 속 외국어가 아니라 다음 사람의 말로 본다

/* 양방향(마이크 1개)에서 다음 사람의 말이 앞 카드에 붙지 않게 잡아 두는 곳.
   엔진은 원문을 언어가 하나인 덩어리로 확정하고 번역을 바로 뒤에 보내지만 <end> 는 늦을 수 있다(2026-11 v6 실측).
   카드 언어와 다른 확정 원문은 카드에 넣지 않고 여기 모은다.
   · 카드 언어로 돌아오면 문장 속 외국어였던 것 → 카드에 되돌린다(drain 후 호출부가 이어 붙임)
   · <end>·문장 끝·충분한 길이(ready) → 다음 사람의 말 → 앞 카드를 확정하고 새 카드로 옮긴다 */
export function flipHold(langs) {
  const lg = (x) => (x ? String(x).split('-')[0].toLowerCase() : '');
  let lang = '', text = '', trans = '', toks = [], raw = [], speaker = '';
  const reset = () => { lang = ''; text = ''; trans = ''; toks = []; raw = []; speaker = ''; };
  const list = () => (typeof langs === 'function' ? langs() : langs); // 안내데스크는 응대 중 언어가 정해진다
  const other = (l, curSrc, curText) => !!l && !!curSrc && l !== curSrc && list().includes(l) && speechWeight(curText) >= FLIP_MIN_CARD;
  return {
    active: () => !!lang,
    lang: () => lang,
    text: () => text,
    trans: () => trans,
    other: (t, curSrc, curText) => other(lg(t.translation_status === 'translation' ? t.source_language : t.language), curSrc, curText),
    // 확정 원문: 잡아 뒀으면 true. 언어 표시가 없는 토큰(부호 등)은 잡아 둔 말에 이어 붙인다.
    takeSource(t, curSrc, curText) {
      const l = lg(t.language);
      if (lang ? (l && l !== lang) : !other(l, curSrc, curText)) return false;
      lang = lang || l;
      text += t.text;
      raw.push(t);
      if (t.text.trim()) toks.push([t.text, typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : null]);
      if (t.speaker != null && t.speaker !== '') speaker = t.speaker;
      return true;
    },
    takeTrans(t) {
      if (!lang || lg(t.source_language) !== lang) return false;
      trans += t.text;
      return true;
    },
    ready: () => !!lang && (endsSentence(text) || speechWeight(text) >= FLIP_READY),
    drain() { const h = { lang, text, trans, toks, raw, speaker }; reset(); return h; },
  };
}
