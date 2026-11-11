/* 다듬기 효과 블라인드 채점 — 평가 보고서(json)의 '다듬기 전'(Soniox 기계 번역)과 '다듬기 후'를 강한 모델이 A/B 순서를 섞어 채점.
   다듬기가 바꾼 문장만 채점한다(안 바꾼 문장은 두 결과가 같다).
   사용: node tools/eval/judge-polish.mjs <보고서.json...> [--to ko] [--model gpt-5] [--name 이름]
     · speech-e2e(rows: heard/translated/raw)·audio-e2e(rows: source/text/raw)·youtube-e2e 보고서를 읽는다.
   출력: tools/eval/out/<이름>.md·.json. ⚠ 과금: OpenAI(채점). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');
const OUT = path.join(DIR, 'out');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const files = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const NAME = opt('name', 'judge-polish');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const LANG = { ko: 'Korean', zh: 'Simplified Chinese', en: 'English', ja: 'Japanese' };

// 채점할 문장 모으기
const items = [];
let unchanged = 0;
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const to = j.to || opt('to', 'ko');
  for (const r of j.rows || []) {
    const src = r.heard ?? r.source ?? '';
    const after = r.translated ?? r.text ?? '';
    const before = r.raw || after;
    if (!src || !after) continue;
    if (before === after) { unchanged++; continue; }
    items.push({ file: path.basename(f, '.json'), to, src, before, after });
  }
}
console.log(`채점 ${items.length}문장(다듬기가 바꾼 문장) · 바뀌지 않은 문장 ${unchanged}개`);

const SYS = 'You are a senior conference interpreter and translation reviewer (Chinese, Korean, English). ' +
  'You compare two candidate translations of the same SOURCE. The SOURCE is a speech-recognition transcript and may contain recognition errors; ' +
  'judge each translation against the SOURCE as given, but do not reward a translation for inventing content that is not in the SOURCE. ' +
  'accuracy (1-5): meaning fidelity — penalize additions, omissions, distortions, wrong names/numbers/terms, changed sentence type (statement vs question). ' +
  'fluency (1-5): how natural the target language reads. major_errors: short list of meaning-changing errors only (not style). ' +
  'better: which translation you would rather show to a listener ("A", "B", or "tie" if practically equal). Reply with JSON only: ' +
  '{"accuracy_A":n,"accuracy_B":n,"fluency_A":n,"fluency_B":n,"major_errors_A":[],"major_errors_B":[],"better":"A|B|tie","reason":"one short sentence"}';

let MODEL = opt('model', 'gpt-5');
async function judge(it) {
  const swap = Math.random() < 0.5; // A/B 순서를 섞는다(위치 편향 방지)
  const A = swap ? it.after : it.before, B = swap ? it.before : it.after;
  const user = `Target language: ${LANG[it.to] || it.to}\n\nSOURCE:\n${it.src}\n\nTranslation A:\n${A}\n\nTranslation B:\n${B}`;
  for (let k = 0; k < 3; k++) {
    const body = { model: MODEL, messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }], response_format: { type: 'json_object' } };
    if (/^gpt-5/.test(MODEL)) body.reasoning_effort = 'low';
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify(body) });
    if (r.status === 404 && MODEL !== 'gpt-5-mini') { MODEL = 'gpt-5-mini'; continue; }
    if (!r.ok) { await new Promise((s) => setTimeout(s, 1500)); continue; }
    const d = await r.json();
    try {
      const v = JSON.parse(d.choices[0].message.content);
      const pick = (a, b) => (swap ? { after: a, before: b } : { after: b, before: a });
      const acc = pick(v.accuracy_A, v.accuracy_B), flu = pick(v.fluency_A, v.fluency_B), err = pick(v.major_errors_A || [], v.major_errors_B || []);
      const better = v.better === 'tie' ? 'tie' : ((v.better === 'A') === swap ? 'after' : 'before');
      return { ...it, acc, flu, err, better, reason: v.reason || '' };
    } catch { /* 다시 시도 */ }
  }
  return { ...it, failed: true };
}

const res = [];
for (let i = 0; i < items.length; i += 6) res.push(...await Promise.all(items.slice(i, i + 6).map(judge))); // 6개씩 동시에
const ok = res.filter((r) => !r.failed);
const mean = (k, s) => (ok.reduce((a, r) => a + r[k][s], 0) / (ok.length || 1)).toFixed(2);
const cnt = (b) => ok.filter((r) => r.better === b).length;
const errs = (s) => ok.reduce((a, r) => a + r.err[s].length, 0);
const introduced = ok.filter((r) => r.err.after.length > r.err.before.length).length;
const fixed = ok.filter((r) => r.err.after.length < r.err.before.length).length;
const summary = { model: MODEL, judged: ok.length, unchanged, prefer: { after: cnt('after'), before: cnt('before'), tie: cnt('tie') },
  accuracy: { before: +mean('acc', 'before'), after: +mean('acc', 'after') }, fluency: { before: +mean('flu', 'before'), after: +mean('flu', 'after') },
  majorErrors: { before: errs('before'), after: errs('after') }, refineIntroducedErrors: introduced, refineFixedErrors: fixed };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, NAME + '.json'), JSON.stringify({ summary, items: res }, null, 1));
let md = `# 다듬기 블라인드 채점 (${MODEL})\n\n- 대상: ${files.map((f) => path.basename(f, '.json')).join(', ')}\n` +
  `- 다듬기가 바꾼 문장 ${ok.length}개 채점 · 바꾸지 않은 문장 ${unchanged}개(두 결과 같음)\n` +
  `- 선호: 다듬기 후 ${summary.prefer.after} · 다듬기 전 ${summary.prefer.before} · 비슷함 ${summary.prefer.tie}\n` +
  `- 정확도(5점): 전 ${summary.accuracy.before} → 후 ${summary.accuracy.after} · 자연스러움: 전 ${summary.fluency.before} → 후 ${summary.fluency.after}\n` +
  `- 뜻이 틀린 오류 수: 전 ${summary.majorErrors.before} → 후 ${summary.majorErrors.after} · 다듬기가 오류를 늘린 문장 ${introduced} · 줄인 문장 ${fixed}\n\n`;
for (const r of ok) {
  md += `### ${r.file} — ${r.better === 'after' ? '다듬기 후 선호' : r.better === 'before' ? '**다듬기 전 선호**' : '비슷함'} (정확도 ${r.acc.before}→${r.acc.after}, 자연스러움 ${r.flu.before}→${r.flu.after})\n\n` +
    `원문: ${r.src}\n\n전: ${r.before}\n\n후: ${r.after}\n\n` +
    (r.err.before.length ? `전 오류: ${r.err.before.join(' / ')}\n\n` : '') + (r.err.after.length ? `후 오류: ${r.err.after.join(' / ')}\n\n` : '') + `판단: ${r.reason}\n\n`;
}
fs.writeFileSync(path.join(OUT, NAME + '.md'), md);
console.log(JSON.stringify(summary));
