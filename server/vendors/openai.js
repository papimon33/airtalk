/* OpenAI(chat completions) — 번역 다듬기(polish)·번역·띄어쓰기 교정 */
import { OPENAI_API_KEY, REFINE_MODEL, LANG_NAMES } from '../config.js';
import { termsConfig } from '../store/index.js';
import { isAckOnly, sanitizeTranslation, langScriptOk, polishLengthOk } from '../util/pipeline_util.js';

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

/* ---- 번역 다듬기(nano): Soniox 기계 번역의 직역투를 자연스러운 구어체로 후교정 ----
   카드 확정(기계 번역 즉시 표시) → 비동기 nano → 같은 id 카드 덮어쓰기.
   폴란드 시연 후속: "유럽 내 도입 사례에서요" → "유럽 쪽 구축 사례를 보면요" 류의 어색한 직역 교정.
   실패·무변경이면 null(원문 유지). TTS 는 이미 재생된 뒤라 자막/기록만 다듬어진다(의도).
   context(직전 대화)가 핵심 — "처음부터요" 같은 단답은 맥락 없이 자연화가 불가능하다. */
const POLISH_MAX_CHARS = 1500;
export async function polishText(src, tgt, tgtLang, context) {
  if (!OPENAI_API_KEY) return null;
  const t = String(tgt || '').trim();
  if (t.length < 4 || isAckOnly(t)) return null; // 단답·초단문은 다듬을 것이 없음(비용 절약)
  // 너무 긴 카드는 다듬지 않는다 — 잘라서 보내면 결과가 카드 전체를 덮어써 뒷부분이 사라진다
  if (t.length > POLISH_MAX_CHARS) return null;
  // 중국어는 간체로 못 박는다 — 지정하지 않으면 가끔 번체자로 고쳐 쓴다
  const langName = tgtLang === 'zh' ? '중국어 간체(简体中文)' : LANG_NAMES[tgtLang] || tgtLang;
  const sys =
    `너는 공항 현장의 전문 통역사다. 외국어 발화의 기계 번역(직역투일 수 있음)을 실제 통역사가 말하듯 자연스러운 ${langName} 구어체로 고쳐라.\n` +
    `- 출력 언어는 반드시 ${langName}. 원문 언어로 되돌려 쓰지 않는다.\n` +
    '- 의미 추가·삭제 금지. 어색한 직역 어순·조사·표현만 자연스럽게 바꾼다.\n' +
    '- [직전 대화]는 맥락 파악용 — "처음부터요" 같은 단답은 맥락에 맞게 자연스럽게 보완해도 된다.\n' +
    '- 이미 자연스러우면 고치지 말고 그대로 출력한다.\n' +
    '- 출력은 고친 번역문 한 줄뿐(설명·따옴표·머리말 금지).' +
    // 교정 예는 한국어 방향일 때만 — 다른 언어로 다듬을 때 한국어 예시가 있으면 한국어로 고쳐 쓰는 일이 있었다
    (tgtLang === 'ko'
      ? '\n교정 예: "유럽 내 도입 사례에서요." → "유럽 쪽 구축 사례를 보면요." / ' +
        '"이제 부탁드립니다." → "그럼 몇 가지 여쭤보겠습니다." / ' +
        '"유럽의 어떤 나라들에서는 이 시스템이 공항에서 이미 작동하나요?" → "유럽 국가 중에 이 시스템을 공항에서 실제 운영 중인 곳이 있나요?"'
      : '');
  try {
    const body = {
      model: REFINE_MODEL,
      // 번역 길이에 맞춘다(한중일은 글자당 1~2토큰). 고정값이면 긴 카드가 중간에 끊긴다
      max_completion_tokens: Math.max(220, t.length * 3),
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `[직전 대화]\n${(context || '(없음)').slice(0, 600)}\n\n[원문] ${String(src || '').slice(0, POLISH_MAX_CHARS * 2)}\n[기계 번역] ${t}` },
      ],
    };
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
    const out = sanitizeTranslation((d?.choices?.[0]?.message?.content || '').trim());
    if (!out || out === t || !polishLengthOk(out, t)) return null; // 무변경·폭주(해설 섞임)·내용 유실 방어
    if (!langScriptOk(out, t, tgtLang)) return null; // 원문 언어로 되돌아갔거나 번체자 — 기계 번역을 그대로 둔다
    return out;
  } catch { return null; }
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
