/* OpenAI(chat completions) — 번역 다듬기(polish)·번역·띄어쓰기 교정 */
import { OPENAI_API_KEY, REFINE_MODEL, LANG_NAMES } from '../config.js';
import { REFINE_NOTES } from './refine_notes.js';
import { termsConfig } from '../store/index.js';
import { isAckOnly, sanitizeTranslation, langScriptOk, copiesContext, addsNote, translationCut, termHintsFrom, scriptLang } from '../util/pipeline_util.js';

/* ------------------------------------------------------------------ */
/*  번역 출력 정화: 소형 모델이 끼워넣는 군더더기 제거                    */
/*   - 머리말("…다음과 같습니다"), 불릿(-), 화살표(원문 → 번역),         */
/*     "참고:/제안:/주의:/Note:" 줄, 끝의 메타 괄호주석 등.              */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  전사된 원문 -> 목표 언어로 번역(+다듬기) : gpt-5-mini                */
/* ------------------------------------------------------------------ */

// 모델별 reasoning_effort: gpt-5.4+ 는 'minimal' 미지원(none/low/…) → 'none',
// 구형 gpt-5(nano/mini)는 'minimal'. 그 외 모델은 미설정.
export function reasoningEffort(model) {
  if (/^gpt-5\.\d/.test(model)) return 'none';
  if (/^gpt-5/.test(model)) return 'minimal';
  return null;
}

/* ---- 번역 감수(다듬기): Soniox 기계 번역을 원문 기준으로 고쳐 쓴다 ----
   카드 확정(기계 번역 즉시 표시) → 비동기 감수 → 같은 id 카드 덮어쓰기. 실패·무변경이면 null(기계 번역 유지).
   2026-11-11 '자연스럽게 다듬기(nano)' → '원문 기준 감수(gpt-5.4-mini)'로 바꿈: 다듬기는 기계 번역을 믿고 말투만 고쳐
   오역(东海→동해, 艺人→예술가, 抱大腿 직역 등)이 그대로 남았다. 중국어 시험(카드 90개, GPT-5.5 MQM 채점)에서
   중대 오류 70 → 8건, 중대 오류 없는 카드 61% → 92%. 모델 차이가 지시문 차이보다 컸다(같은 지시문 nano 59건).
   언어쌍별 표기 규칙은 refine_notes.js, 원문에 나온 등록 용어는 [용어]로 함께 준다(엔진이 용어집을 안 따를 때 대비).
   TTS 는 이미 재생된 뒤라 자막/기록만 바뀐다(의도). context(직전 대화)는 단답·조각 문장의 맥락용. */
const POLISH_MAX_CHARS = 1500;
const langLabel = (lg) => (lg === 'zh' ? '중국어 간체(简体中文)' : LANG_NAMES[lg] || lg);
// 시스템 지시문은 언어쌍마다 고정(용어·맥락은 사용자 메시지) — 같은 앞부분이 반복돼 입력 캐시 할인을 받는다
function refineSystem(from, to) {
  const notes = REFINE_NOTES[`${from}>${to}`] || [];
  const tl = langLabel(to);
  return `너는 ${LANG_NAMES[from] || '외국어'}→${tl} 전문 동시통역사이자 번역 감수자다. [원문]은 실시간 음성 인식 결과이고, [기계 번역]은 엔진이 만든 초벌 번역이다. [원문]의 뜻을 정확하고 자연스러운 ${tl}로 옮긴 최종 번역문을 써라.
규칙
1. 정확성이 먼저다. [기계 번역]이 원문과 다르면(오역·누락·추가·어색한 직역) 원문에 맞게 고친다. 맞고 자연스러운 부분은 그대로 둔다.
2. 원문에 없는 내용을 넣지 않고, 있는 내용을 빼지 않는다. 나열된 이름·숫자·날짜는 모두 옮긴다.
3. 논리 관계(원인·조건·양보·순서)와 사실 관계(했다/하려 했다/할 수 있다)를 바꾸지 않는다. 원문보다 센 말로 과장하지 않는다.
4. 관용구·속어·사자성어는 글자 그대로가 아니라 뜻으로 옮긴다.
5. 고유명사·전문 용어는 ${tl}에서 통용되는 표준 표기를 쓴다. [용어]가 있으면 그대로 따른다.
6. ${tl} 원어민이 실제로 쓰는 표현으로 쓴다. 번역투를 피하고, 주어와 서술어가 맞는지 확인한다. 말더듬·되풀이·군말은 정리한다.
7. 화자의 말투(격식체·구어체)와 문장 종류(평서문·의문문)를 유지하고, 한 번역문 안에서 말투를 섞지 않는다.
8. 원문에 문맥상 명백한 음성 인식 오류(발음이 같거나 비슷한 다른 말)가 있으면 의도한 말로 이해해 옮긴다. 확실하지 않으면 원문대로 옮긴다.
9. 원문이 문장 중간에서 끊긴 조각이면 조각 그대로 자연스럽게 옮긴다. [직전 대화]는 맥락 참고용이다. 그 내용을 옮겨 쓰지 않는다.
10. 출력은 최종 번역문 한 줄뿐이다. 출력 언어는 반드시 ${tl}. 설명·따옴표·머리말·괄호 메모를 넣지 않는다.${notes.length ? '\n표기 규칙\n- ' + notes.join('\n- ') : ''}`;
}
const refineUser = (src, mt, tgtLang, context) => {
  const hints = termHintsFrom(termsConfig.entries, src, tgtLang);
  return `[직전 대화]\n${(context || '(없음)').slice(0, 600)}\n${hints.length ? '\n[용어] ' + hints.join(' / ') + '\n' : ''}\n[원문] ${src}\n[기계 번역] ${mt}`;
};
// 평가 도구용: 다른 모델로 같은 지시문을 시험할 때 쓴다(tools/eval)
export const refinePrompt = (src, mt, tgtLang, context) => ({ sys: refineSystem(scriptLang(src), tgtLang), user: refineUser(src, mt, tgtLang, context) });
async function refineCall(sys, user, maxTokens) {
  const body = { model: REFINE_MODEL, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] };
  const re = reasoningEffort(REFINE_MODEL);
  if (re) body.reasoning_effort = re;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  const d = await r.json();
  if (d?.choices?.[0]?.finish_reason === 'length') return null; // 토큰 한도로 끊긴 결과 — 쓰면 뒷부분을 잃는다
  return sanitizeTranslation((d?.choices?.[0]?.message?.content || '').trim()) || null;
}
export async function polishText(src, tgt, tgtLang, context) {
  if (!OPENAI_API_KEY) return null;
  const t = String(tgt || '').trim();
  const s = String(src || '').trim();
  if (t.length < 4 || isAckOnly(t)) return null; // 단답·초단문은 고칠 것이 없음(비용 절약)
  // 너무 긴 카드는 건드리지 않는다 — 잘라서 보내면 결과가 카드 전체를 덮어써 뒷부분이 사라진다
  if (t.length > POLISH_MAX_CHARS || s.length > POLISH_MAX_CHARS * 2) return null;
  try {
    // 번역 길이에 맞춘다(한중일은 글자당 1~2토큰). 고정값이면 긴 카드가 중간에 끊긴다
    const out = await refineCall(refineSystem(scriptLang(s), tgtLang), refineUser(s, t, tgtLang, context), Math.max(400, t.length * 4));
    if (!out || out === t) return null;
    if (out.length > t.length * 3 + 20) return null;      // 폭주(해설 섞임)
    if (translationCut(s, out)) return null;              // 원문에 비해 내용이 크게 빠짐
    if (!langScriptOk(out, t, tgtLang)) return null;      // 원문 언어로 되돌아갔거나 번체자·원문 글자가 섞임
    // 직전 대화 문장을 옮겨 붙임(말하지 않은 내용) — 기계 번역보다 눈에 띄게 길어졌을 때만 본다:
    // 화자가 앞말을 되풀이하면(앵커 → 기자) 감수 결과가 직전 번역과 겹치는 것이 정상이다
    if (out.length > t.length * 1.3 + 10 && copiesContext(out, t, context)) return null;
    if (addsNote(out, t)) return null;                    // 기계 번역에 없던 괄호 — 모델의 메모가 섞임
    return out;
  } catch { return null; }
}

/* ---- 다시 번역: 엔진 번역이 중간에 끊긴 카드(translationCut)는 끊긴 번역을 참고만 하고 원문 전체를 새로 옮긴다 ----
   지명을 길게 나열하면 Soniox 번역이 '…마닐라,'에서 멈춘다(2026-11-11, 엔진 원본 메시지로 확인). 감수와 같은 지시문·모델을 쓴다.
   결과가 목표 언어가 아니거나 여전히 끊겨 있으면 null(엔진 번역 유지). */
export async function retranslateText(src, tgtLang, context, cutMt) {
  if (!OPENAI_API_KEY) return null;
  const s = String(src || '').trim();
  if (!s || s.length > POLISH_MAX_CHARS * 2) return null;
  const sys = refineSystem(scriptLang(s), tgtLang);
  const user = refineUser(s, `${String(cutMt || '').trim() || '(없음)'} …(엔진 번역이 여기서 끊김 — 원문 전체를 빠짐없이 옮길 것)`, tgtLang, context);
  for (let k = 0; k < 2; k++) { // 검사에서 떨어지면 한 번 더
    try {
      const out = await refineCall(sys, user, Math.max(600, s.length * 5));
      // 목표 언어가 아니거나, 여전히 끊겼거나, 원문에 없던 괄호(메모)가 붙었으면 버린다
      if (!out || !langScriptOk(out, '', tgtLang) || translationCut(s, out) || addsNote(out, s)) continue;
      return out;
    } catch { /* 다시 시도 */ }
  }
  return null;
}

export async function translateText(text, targetLang, polish, context, model) {
  const useModel = model && /^gpt-/.test(model) ? model : REFINE_MODEL;
  const langName = LANG_NAMES[targetLang] || targetLang;
  try {
    const sys = polish
      ? `너는 전문 동시통역사다. 실시간 음성에서 받아쓴 텍스트(말하는 도중 끊긴 단편일 수 있음)를 ${langName}로 옮긴다. 딱딱한 직역투·문어체를 피하고, 실제 사람이 말하듯 자연스러운 '구어체'로 옮긴다. 의미가 매끄럽게 전달되도록 적당히 의역한다.
규칙:
- 여러 문장이 함께 들어오면 각 문장을 그대로 문장 단위로 옮기고, 서로 억지로 합치지 않는다.
- 문체는 입으로 말하는 자연스러운 구어체로 한다. 글로 쓴 듯한 딱딱한 문어체("~하였다", "~이다", 번역체)를 피하고, 말할 때 쓰는 표현("~예요/~해요/~거든요/~네요" 등)으로 옮긴다. 정중함은 유지하되 반말은 섞지 않는다. 직역해서 어색한 표현은 한국어다운 표현으로 바꾼다(자연스러움 우선, 의미는 정확히 유지).
- 고유명사·지명·상품명·음식명은 발음을 살려 표기하고 억지로 의역하지 않는다 (예: 初島→하츠시마, ところてん/所天→도코로텐, 天草→텐구사).
- "(혹은 …)", "(서쪽?)" 같은 추측성 괄호나 부연을 절대 넣지 않는다. 불확실해도 가장 자연스러운 하나로만 옮긴다.
- 앞 맥락(이전 대화)이 주어지면 그 흐름에 자연스럽게 이어 옮긴다.
- 출력은 오직 ${langName} 번역문 한 덩어리뿐이다. 입력이 짧거나 애매해도 절대 해설/분석/제안을 하지 마라.
- 금지: "…다음과 같습니다", "번역하면", "참고:", "제안:", "Note:" 같은 머리말·맺음말; 불릿(-)·번호·화살표(→); 원문 다시 쓰기(원문 병기); 괄호 안 설명. 번역문만 그대로 출력한다.
- 이미 ${langName}면 자연스럽게 교정만 한다.`
      : `너는 번역기다. 입력을 ${langName}로 정확히 옮긴다. 고유명사는 발음을 살린다. 출력은 ${langName} 번역문만. 머리말·해설·불릿·화살표·괄호설명·원문 병기 금지. 이미 ${langName}면 그대로 출력한다.`;
    const messages = [{ role: 'system', content: sys }];
    // 이전 맥락을 few-shot 으로 제공해 연속성/용어 일관성 확보
    if (context && context.length) {
      for (const p of context) {
        messages.push({ role: 'user', content: p.src });
        messages.push({ role: 'assistant', content: p.tr });
      }
    }
    messages.push({ role: 'user', content: text });
    const body = { model: useModel, messages, max_completion_tokens: 500 };
    const re = reasoningEffort(useModel);
    if (re) body.reasoning_effort = re;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error('[translate] HTTP', r.status, await r.text());
      return text;
    }
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    const clean = sanitizeTranslation(raw);
    return clean || text; // 정화 후 비면 원문으로 폴백(빈 카드 방지)
  } catch (e) {
    console.error('[translate] error', e);
    return text;
  }
}

/* translate 파이프라인 다듬기: 단어·표현·어순·문장부호는 그대로 두고 띄어쓰기만 교정 */
export async function spacingPolish(text) {
  try {
    const sys =
      '입력 문장의 단어·표현·어순·문장부호·내용은 절대 바꾸지 마라. 오직 띄어쓰기(공백)만 자연스럽게 교정해서 그대로 출력한다. 의역·교체·추가·삭제 금지. 설명 없이 교정된 문장만 출력.';
    const body = {
      model: REFINE_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text },
      ],
      max_completion_tokens: 400,
    };
    const re = reasoningEffort(REFINE_MODEL);
    if (re) body.reasoning_effort = re;
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) return text;
    const data = await r.json();
    return data?.choices?.[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}
