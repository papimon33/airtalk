/* Soniox 실시간 STT — 연결(헤더 인증)·세션 context(용어집) 조립·용어 실검증·발화 언어 판정 */
import { WebSocket } from 'ws';
import { SONIOX_WS_URL, SONIOX_API_KEY, SONIOX_MODEL } from '../config.js';
import { termsConfig } from '../store/index.js';
import { TERM_LANGS } from '../store/terms.js';
import { trimScopedTerms } from '../util/pipeline_util.js';

// Soniox 실시간 STT 연결 — 키는 연결 요청의 Authorization 헤더로 보낸다.
// start(config) 메시지의 api_key 는 2027-01-15 에 중단되므로 config 에는 키를 넣지 않는다.
export const openSonioxWs = () => new WebSocket(SONIOX_WS_URL, { headers: { Authorization: `Bearer ${SONIOX_API_KEY}` } });

// 데스크 모드 전용 general context — Soniox 에 "이 자리가 어떤 상황인지" 배경을 줘서
// 저빈도·동음이의 단어(예 喫煙室=きつえんしつ) 인식률을 끌어올린다. context.general = [{key,value}].
// 흡연실처럼 STT 가 자꾸 헷갈리는 단어는 value 에 일본어 표기를 괄호로 병기.
const DESK_GENERAL_CONTEXT = [
  { key: 'location', value: 'Airport information desk' },
  { key: 'airport', value: 'Gimpo International Airport' },
  { key: 'facilities', value: 'smoking room (喫煙室 / きつえんしつ), restroom, currency exchange, convenience store, subway station, boarding gate' },
];
// Soniox 세션 context 조립(통합 v3 entries 기반). langs=이 세션 활성 언어, opts.desk=데스크 세션 여부.
//  - mode 'pair'      : 활성 언어쌍 양방향 번역 + 인식
//  - mode 'inputOnly' : 외국어 표기 → 한국어(ko) 단방향 번역 + 인식 (약칭·오인식 교정)
//  - mode 'recognize' : 언어무관 인식 힌트만
//  - scope: '*' 아니면 그 언어가 활성일 때만 주입 / categoryScope: 데스크·일반세션 적용 여부
//  - 데스크 세션은 general(공항 안내데스크 배경)도 함께 주입 — 저빈도 단어 인식 보정.
//  - 폴백(en→ko) 없음: 명시된 언어 표기만 사용. 전체 한도(8,000토큰≈10,000자) 방어는 유지.
/* opts.target — 단방향(one_way) 세션의 타깃 언어. 주면 번역쌍을 'X→타깃' 방향만 만든다.
   이전에는 활성 언어 전 조합(4언어=12쌍/항목)을 만들어 ja→zh 처럼 그 세션에서 절대 쓰이지 않는
   쌍이 자리를 차지했고, context 가 한도(9500자)를 1.9배 초과해 뒤쪽 항목(항공사 번역쌍 전체)이
   잘려 'Jeju Air→제주에어' 같은 오역이 났다. 2026-07-29 세션 로그 분석 근거. */
export function buildSonioxContextRaw(langs, opts = {}) {
  return collectSonioxContext(langs, opts).ctx;
}
// context + 각 번역쌍·인식어가 어느 '언어 지정 용어'에서 왔는지(한도 초과 때 먼저 뺄 순서). 전체 언어 용어에서 온 것은 null.
function collectSonioxContext(langs, opts = {}) {
  const desk = !!opts.desk;
  const target = opts.target && TERM_LANGS.includes(opts.target) ? opts.target : null;
  const L = [...new Set((langs || []).filter((c) => TERM_LANGS.includes(c)))];
  if (!L.length) L.push('ko', 'en');
  const cs = termsConfig.categoryScope || {};
  const terms = new Map(); // 인식어 → 만든 언어 지정 용어의 번호(전체 언어 용어도 만들었으면 null)
  const pairs = [];
  const pairMeta = [];
  const seen = new Set();
  let from = null; // 지금 처리 중인 용어: 언어 지정이면 목록 번호, 아니면 null
  const addTerm = (v) => {
    if (!terms.has(v)) terms.set(v, from);
    else if (from == null) terms.set(v, null); // 전체 언어 용어도 쓰는 인식어는 먼저 빼지 않는다
  };
  const addPair = (a, b) => {
    if (!a || !b || a === b) return;
    const k = a + '||' + b;
    if (!seen.has(k)) { seen.add(k); pairs.push({ source: a, target: b }); pairMeta.push(from); }
  };
  // 표기 결정: 한·영·일은 명시 표기만(비면 없음), 그 외 언어(zh 포함 미입력 시·es/fr/ru 등)는
  // 영어 표기로 폴백 — 어떤 세션 언어에서도 고유명사가 최소 영어 브랜드명으로 일관 번역되도록 보장.
  const nameFor = (names, lg) => {
    const v = String(names[lg] || '').trim();
    if (v) return v;
    if (lg === 'ko' || lg === 'en' || lg === 'ja') return '';
    return String(names.en || '').trim();
  };
  (termsConfig.entries || []).forEach((e, idx) => {
    if (!e || !e.names || !e.names.ko) return;
    const scope = cs[e.category] || { desk: true, session: true };
    if (desk ? scope.desk === false : scope.session === false) return; // 카테고리 적용대상(데스크 항공용어 제외 등)
    const scoped = Array.isArray(e.scope) && !e.scope.includes('*');
    if (scoped && !e.scope.some((sl) => L.includes(sl))) return;       // 언어 스코프
    // 한도 초과 때 먼저 뺄 용어: 언어 지정 용어(지명 등). 항공사 약칭(国航·JAL 등, 기본 시드)은 핵심이라 제외 — 지명이 없으면 기존과 똑같이 자른다
    from = scoped && e.category !== 'airline' ? idx : null;
    if (e.mode === 'recognize') { const v = String(e.names.ko || '').trim(); if (v) addTerm(v); return; }
    for (const lg of L) { const v = nameFor(e.names, lg); if (v) addTerm(v); } // 활성 언어 표기 → 인식 힌트
    const ko = String(e.names.ko || '').trim();
    if (e.mode === 'inputOnly') {
      if (!ko || !L.includes('ko')) return;
      for (const lg of L) { if (lg === 'ko') continue; addPair(String(e.names[lg] || '').trim(), ko); } // 외국어 → ko 단방향(약칭은 폴백 없음)
    } else if (target) { // pair + 단방향 세션: 실제 번역 방향(X→타깃)만 생성
      for (const a of L) { if (a !== target) addPair(nameFor(e.names, a), nameFor(e.names, target)); }
    } else { // pair + 양방향(또는 타깃 미지정): 활성 언어 간 전 방향
      for (const a of L) for (const b of L) { if (a !== b) addPair(nameFor(e.names, a), nameFor(e.names, b)); }
    }
  });
  const ctx = {};
  if (desk && DESK_GENERAL_CONTEXT.length) ctx.general = DESK_GENERAL_CONTEXT; // 데스크 배경(공항 안내데스크)
  if (terms.size) ctx.terms = [...terms.keys()];
  if (pairs.length) ctx.translation_terms = pairs;
  return { ctx: Object.keys(ctx).length ? ctx : null, pairMeta, termMeta: [...terms.values()] };
}
export function buildSonioxContext(langs, opts = {}) {
  const { ctx, pairMeta, termMeta } = collectSonioxContext(langs, opts);
  if (!ctx) return null;
  // 한도 방어 ① 언어 지정 용어(예: 중국어 지명)를 목록 뒤쪽부터 통째로 먼저 뺀다 — 새로 넣은 지명이 기존 용어를 밀어내지 않게
  let dropped = trimScopedTerms(ctx, pairMeta, termMeta, 9500);
  // 한도 방어 ② 그래도 넘치면 번역쌍부터, 다음 인식 힌트를 뒤에서부터 잘라낸다(전부 잘리면 경고만).
  // 초과분에 비례해 청크로 제거 — 대용량 업로드(수천 항목)여도 몇 번의 stringify 로 반드시 한도 안에 들어오고,
  // 항목 1개씩 pop×전체 재직렬화로 이벤트루프를 수초 막던 문제도 없음.
  for (let pass = 0; pass < 60; pass++) {
    const len = JSON.stringify(ctx).length;
    if (len <= 9500) break;
    const excess = len - 9500;
    const arr = (ctx.translation_terms && ctx.translation_terms.length) ? ctx.translation_terms : ctx.terms;
    if (!arr || !arr.length) break;
    const avg = Math.max(8, Math.floor(len / (((ctx.translation_terms || []).length + (ctx.terms || []).length) || 1)));
    const n = Math.min(arr.length, Math.max(1, Math.ceil(excess / avg)));
    arr.splice(-n);
    dropped += n;
    if (ctx.translation_terms && !ctx.translation_terms.length) delete ctx.translation_terms;
    if (ctx.terms && !ctx.terms.length) delete ctx.terms;
  }
  if (dropped > 0) console.warn(`[terms] Soniox context 한도 초과 — ${dropped}개 항목 잘림(langs=${(langs || []).join(',')}${opts.desk ? ',desk' : ''})`);
  return Object.keys(ctx).length ? ctx : null;
}

/* ---- 용어 설정 실검증: 저장된 설정을 실제 soniox 에 던져 언어쌍별 수락/거부 확인 ----
   글자수 추정(≈10,000자)은 토큰≠글자라 부정확 → 각 운영 언어쌍(ko↔L) context 로 soniox WS 를
   열어 config 만 보내고 수락/에러(용량초과 등)를 판정한 뒤 즉시 닫는다(오디오 미전송 → 과금 최소). */
export function validateSonioxPair(a, b, ctx) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {} resolve(r); };
    let ws;
    try { ws = openSonioxWs(); }
    catch (e) { return resolve({ ok: false, error: String(e.message || e) }); }
    const timer = setTimeout(() => finish({ ok: true }), 3000); // 수락되면 오디오 대기로 무응답 → 통과
    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({
          model: SONIOX_MODEL, audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
          enable_language_identification: true, enable_endpoint_detection: true,
          language_hints: [a, b], translation: { type: 'two_way', language_a: a, language_b: b },
          ...(ctx ? { context: ctx } : {}),
        }));
      } catch (e) { finish({ ok: false, error: String(e.message || e) }); }
    });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.error_code || m.error_message) finish({ ok: false, error: `${m.error_code || ''} ${m.error_message || ''}`.trim() });
      else finish({ ok: true }); // 정상 응답(토큰/메타) → 수락
    });
    ws.on('error', (e) => finish({ ok: false, error: String((e && e.message) || e) }));
    ws.on('close', (code, reason) => finish(code === 1000 ? { ok: true } : { ok: false, error: `closed ${code} ${String(reason || '').slice(0, 80)}`.trim() }));
  });
}
