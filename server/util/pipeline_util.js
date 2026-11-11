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
/* 한자·가나도 같다: 목표가 중국어·일본어가 아닌데 기계 번역에 없던 한자·가나가 생기면 원문 글자가 샌 것이다
   (2026-11-11 중→한 테스트: '어디서 받나요?' → '어디서办理하나요?'). */
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const KANA = /[\u3040-\u30FF]/;
/* 다듬기 결과 길이 검사: 해설이 섞여 크게 늘었거나, 내용이 빠져 크게 줄었으면 기계 번역을 유지한다.
   짧은 문장은 자연스럽게 고치면서 많이 줄 수 있으니(31자 → 18자) 40자 이상일 때만 줄어든 비율을 본다.
   20자 이상 문장이 1.5배 넘게 늘면 내용이 덧붙은 것이다(2026-11-11 BBC 인터뷰: 앞 사람 말이 뒤에 붙어 85자 → 150자).
   짧은 단답은 맥락으로 보완할 수 있게(프롬프트 허용) 늘어나는 비율을 따지지 않는다. */
export function polishLengthOk(out, raw) {
  if (out.length > raw.length * 3 + 20) return false;
  if (raw.length >= 20 && out.length > raw.length * 1.5 + 10) return false;
  return raw.length < 40 || out.length >= raw.length * 0.6;
}

/* 다듬기가 [직전 대화]의 문장을 옮겨 붙였나: 기계 번역엔 없고 직전 대화엔 있는 8글자 조각이 출력의 20% 이상이면 버린다.
   (2026-11-11 BBC 인터뷰: 바로 앞 카드의 번역문이 다음 카드 다듬기 결과 뒤에 그대로 붙었다) */
export function copiesContext(out, raw, context) {
  const n = (x) => String(x || '').replace(/[\s\p{P}\p{S}]/gu, '');
  const o = n(out), r = n(raw), c = n(context);
  if (o.length < 16 || !c) return false;
  const W = 8;
  let total = 0, copied = 0;
  for (let i = 0; i + W <= o.length; i += 2) {
    const g = o.slice(i, i + W);
    total++;
    if (!r.includes(g) && c.includes(g)) copied++;
  }
  return total > 0 && copied / total >= 0.2;
}

/* 다듬기가 기계 번역에 있던 등록 용어(목표 언어 표기)를 지웠나 — 지웠으면 다듬기를 버린다.
   엔진은 용어집대로 옮겼는데 다듬기가 덮어쓰는 일이 있었다(2026-11-11 한→중: '十五五规划' → '十四五'). */
export function termsKept(out, raw, terms) {
  const sq = (x) => String(x || '').replace(/\s+/g, '');
  const o = sq(out), r = sq(raw);
  for (const t of terms || []) {
    const k = sq(t);
    if (k.length >= 2 && r.includes(k) && !o.includes(k)) return false;
  }
  return true;
}

/* 엔진 번역이 중간에 끊겼나 — 지명을 길게 나열하면 Soniox 번역이 '…마닐라,'에서 멈추고 문장 끝(<end>)이 온다
   (2026-11-11 지명 시험, 엔진 원본 메시지로 확인: 원문은 끝까지 인식됐는데 확정 번역 조각이 더 오지 않았다).
   원문은 문장이 끝났는데 번역이 쉼표로 끝나거나, 번역 분량이 원문의 45% 미만이면 끊긴 것으로 본다.
   분량은 글자 종류별 가중(한자 1.5·한글 1·가나 0.8·로마자 0.35·숫자 0.5)으로 언어 차이를 맞춘다. 짧은 발화는 따지지 않는다. */
const weightOf = (s) => {
  let w = 0;
  for (const ch of String(s || '')) {
    if (HAN.test(ch)) w += 1.5;
    else if (HANGUL.test(ch)) w += 1;
    else if (KANA.test(ch)) w += 0.8;
    else if (/[A-Za-z]/.test(ch)) w += 0.35;
    else if (/[0-9]/.test(ch)) w += 0.5;
  }
  return w;
};
export function translationCut(src, tgt) {
  const s = String(src || '').trim(), t = String(tgt || '').trim();
  if (!s || !t) return false;
  const ws = weightOf(s);
  if (ws < 30) return false;
  if (/[。．.!?！？…」』"”]$/.test(s) && /[,，、:：;；]$/.test(t)) return true;
  return weightOf(t) < ws * 0.45;
}

/* 다시 번역할 때 넘길 용어 표기: 원문에 나온 등록 용어(어느 언어 표기든) → 목표 언어 표기, 최대 40개 */
export function termHintsFrom(entries, src, tgtLang) {
  const s = String(src || ''), out = [];
  for (const e of entries || []) {
    const to = e && e.names && String(e.names[tgtLang] || '').trim();
    if (!to) continue;
    for (const [lg, v] of Object.entries(e.names)) {
      const from = String(v || '').trim();
      if (lg === tgtLang || from.length < 2 || !s.includes(from)) continue;
      out.push(`${from}→${to}`);
      break;
    }
    if (out.length >= 40) break;
  }
  return out;
}

/* Soniox context 토큰 수 추정 — 한도는 8,000토큰(2026-11-11 실측: 거부 메시지 'Context is too long: N tokens, the maximum is 8000').
   엔진은 JSON 글자가 아니라 용어 문자열을 센다(실측): 한자·한글·가나 글자당 1, 인식어 1개당 +1, 번역쌍 1개당 약 +3.
   영숫자 묶음은 4글자당 1(최소 1), 기호는 1. 번역쌍은 3.5로 넉넉히 — 실측 11개 지점에서 -1.8% ~ +4.8%.
   (글자 수로는 한·중 위주 약 24,200자, 한·영 위주 약 30,500자에서 한도에 닿아 글자 수 한도는 맞지 않는다) */
const CJK_CHAR = /[぀-ヿ㐀-鿿豈-﫿가-힣]/;
const strTokens = (s) => {
  let t = 0;
  for (const m of String(s || '').matchAll(/[぀-ヿ㐀-鿿豈-﫿가-힣]|[A-Za-z0-9]+|[^\sA-Za-z0-9]/g)) {
    const x = m[0];
    if (CJK_CHAR.test(x)) t += 1;
    else if (/^[A-Za-z0-9]+$/.test(x)) t += Math.max(1, Math.ceil(x.length / 4));
    else t += 1;
  }
  return t;
};
export function estimateContextTokens(ctx) {
  const c = ctx || {};
  let t = 10;
  for (const s of c.terms || []) t += strTokens(s) + 1;
  for (const p of c.translation_terms || []) t += strTokens(p.source) + strTokens(p.target) + 3.5;
  for (const g of c.general || []) t += strTokens(g.key) + strTokens(g.value) + 3.5;
  if (typeof c.text === 'string') t += strTokens(c.text);
  return Math.ceil(t);
}

/* Soniox context 한도 맞추기 ① — 언어를 지정한 용어(scope 가 특정 언어)를 목록 뒤쪽 용어부터 통째로(번역쌍·인식어 함께) 뺀다.
   언어 지정 용어(예: 중국어 지명)는 그 언어로 잠긴 뒤엔 context 가 작아 다시 들어간다 — 잠기기 전 자동 감지(4개 언어)에서
   새로 넣은 지명이 기존 항공사·항공 용어를 밀어내지 않게 한다(2026-11-11: 지명 87개 → 기존 용어 129개가 잘릴 뻔).
   pairMeta·termMeta: 각 번역쌍·인식어를 만든 용어의 목록 번호(언어 지정 용어일 때) 또는 null(전체 언어 용어 — 여기선 안 뺌).
   반환: 뺀 항목 수. ctx 를 직접 고친다. */
export function trimScopedTerms(ctx, pairMeta, termMeta, limit) {
  if (!ctx) return 0;
  let len = JSON.stringify(ctx).length;
  if (len <= limit) return 0;
  const pairs = ctx.translation_terms || [], terms = ctx.terms || [];
  const order = [...new Set([...pairMeta, ...termMeta].filter((x) => x != null))].sort((a, b) => b - a);
  const cut = new Set();
  for (const i of order) {
    if (len <= limit) break;
    cut.add(i);
    pairs.forEach((p, k) => { if (pairMeta[k] === i) len -= JSON.stringify(p).length + 1; });
    terms.forEach((t, k) => { if (termMeta[k] === i) len -= JSON.stringify(t).length + 1; });
  }
  if (!cut.size) return 0;
  const keepP = pairs.filter((_, k) => !cut.has(pairMeta[k])), keepT = terms.filter((_, k) => !cut.has(termMeta[k]));
  const dropped = pairs.length - keepP.length + terms.length - keepT.length;
  if (ctx.translation_terms) { if (keepP.length) ctx.translation_terms = keepP; else delete ctx.translation_terms; }
  if (ctx.terms) { if (keepT.length) ctx.terms = keepT; else delete ctx.terms; }
  return dropped;
}

/* 다듬기가 기계 번역에 없던 괄호를 덧붙였나 — 모델의 혼잣말(교정 메모)이 섞인 것이다.
   (2026-11-11 지명 시험: '와이키키(탄샹산은 의역이므로 고쳐야 하지만 고유명사와 숫자 유지)') */
export function addsNote(out, raw) {
  const n = (s) => (String(s || '').match(/[(（[［]/g) || []).length;
  return n(out) > n(raw);
}

/* 글자로 본 원문 언어(감수 지시문의 언어쌍 고르기용): 가나 → ja, 한글 → ko, 한자만 → zh, 그 밖 → en */
export function scriptLang(text) {
  const s = String(text || '');
  let hg = 0, kana = 0, han = 0, lat = 0;
  for (const ch of s) { if (HANGUL.test(ch)) hg++; else if (KANA.test(ch)) kana++; else if (HAN.test(ch)) han++; else if (/[A-Za-z]/.test(ch)) lat++; }
  if (kana >= 2 && kana + han >= hg) return 'ja';
  if (hg && hg >= han) return 'ko';
  if (han && han * 3 >= lat) return 'zh';
  return 'en';
}

export function langScriptOk(out, raw, lang) {
  const s = String(out || ''), r = String(raw || '');
  if (lang !== 'ko' && HANGUL.test(s) && !HANGUL.test(r)) return false;
  if (lang === 'zh' && ZH_TRAD.test(s) && !ZH_TRAD.test(r)) return false;
  if (lang !== 'zh' && lang !== 'ja') {
    if (HAN.test(s) && !HAN.test(r)) return false;
    if (KANA.test(s) && !KANA.test(r)) return false;
  }
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
