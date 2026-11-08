/* 대화(양방향 통역) 음성 → 우리 서버(실제 Soniox two_way 인식·번역 + 다듬기) 끝까지 번역 확인.
   시나리오(json) → 줄별 Cartesia 음성(화자 언어별 목소리, 캐시) → 로컬 서버(격리 DATA_DIR, 운영 DB 안 씀)에
   앱 양방향 통역과 같은 방식(마이크 1개 = 두 사람 음성이 한 채널)으로 실시간 속도로 흘려 넣기
   → 줄별 [화자 / 시나리오 원문 / 인식 원문 / 판정된 언어 / 번역(상대 언어)] 보고서(md·json).
   사용: node tools/eval/dialogue-e2e.mjs <scenario.json> [--name 이름] [--lines 1,6-7] [--terms 용어.json] [--max-delay ms] [--sens -1~1] [--echo dB] [--no-agent] [--dry(줄·글자 수만 확인)]
     · 시나리오: { a: 'ko', b: 'ja', lines: [{ speaker: 'ko'|'ja', text }] } (배열만 있어도 됨 — 언어는 줄에서 뽑는다)
     · --lines: 그 줄만 재생(번호는 시나리오 그대로). --terms: 용어 설정 entries 배열([{ category, names:{ko,ja,…}, mode }])을
       테스트 서버 용어집(기본 시드)에 더한 뒤 시작 — 운영 용어집에 넣기 전에 효과 확인용
   출력: tools/eval/out/<이름>.md·.json·.server.log (git 무시). 음성 캐시: tools/eval/tts-audio/speech/
   템플릿: speech-e2e.mjs(단방향 발표). 다른 점 — 세션 twoway·auto, 언어 판정·화자별 집계, 다듬기 전 번역도 기록.
     · --echo dB: 이 기기 TTS 를 켜고, 서버가 보낸 TTS 음성을 그만큼 줄여 마이크 입력에 섞는다(스피커 소리가 새는 상황).
       --no-agent: 에이전트 텍스트 입력을 끄고 비교(SONIOX_AGENT_TEXT=0). 보고서에 'TTS 가 사람 말로 잡힌 카드' 수가 나온다.
   ⚠ 과금: Cartesia(처음 합성만, 이후 캐시)·Soniox(실시간 인식·번역)·OpenAI(다듬기). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { bootServer, loginAdmin } from '../../test/helpers/boot.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');
const CACHE = path.join(DIR, 'tts-audio', 'speech');
const OUT = path.join(DIR, 'out');
const RATE = 24000;
const VOICE = {
  ko: '89f4372f-1f73-4b85-8e1e-5d24ed8bc826', // Jaewon(남성)
  ja: 'd0ff6870-dd30-420d-8568-d756d806ea62', // Hinata
};
const LANG_NAME = { ko: '한국어', ja: '일본어', en: '영어', zh: '중국어' };
const GAP_S = 1.2;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ECHO_DB = args.includes('--echo') ? Number(args[args.indexOf('--echo') + 1]) : null;
const ECHO = ECHO_DB == null ? 0 : 10 ** (-ECHO_DB / 20); // 새는 TTS 소리 크기(배율)
const NO_AGENT = args.includes('--no-agent');
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!file) { console.error('사용: node tools/eval/dialogue-e2e.mjs <scenario.json> [--name 이름]'); process.exit(1); }
const NAME = opt('name', path.basename(file).replace(/\.[^.]+$/, ''));

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 시나리오 ---- */
const scen = JSON.parse(fs.readFileSync(file, 'utf8'));
const pick = opt('lines') && new Set(opt('lines').split(',').flatMap((p) => { const [a, b = a] = p.split('-').map(Number); return Array.from({ length: b - a + 1 }, (_, k) => a + k); }));
const lines = (Array.isArray(scen) ? scen : scen.lines).map((l, i) => ({ i: i + 1, speaker: l.speaker, text: l.text.trim() })).filter((l) => !pick || pick.has(l.i));
const TERMS = opt('terms') ? JSON.parse(fs.readFileSync(opt('terms'), 'utf8')) : null;
const langs = [...new Set(lines.map((l) => l.speaker))];
const A = scen.a || langs[0], B = scen.b || langs.find((l) => l !== A);
for (const l of lines) if (!VOICE[l.speaker]) { console.error(`❌ ${l.i}번 줄: '${l.speaker}' 목소리 없음`); process.exit(1); }
const other = (lang) => (lang === A ? B : A);
const chars = lines.reduce((a, l) => a + l.text.length, 0);
if (args.includes('--dry')) {
  for (const l of lines) console.log(`${String(l.i).padStart(2)} [${l.speaker}] ${l.text}`);
  console.log(`줄 ${lines.length}개 · ${chars}자 (${langs.map((g) => `${g} ${lines.filter((l) => l.speaker === g).length}줄`).join(', ')})`);
  process.exit(0);
}
for (const k of ['CARTESIA_API_KEY', 'SONIOX_API_KEY', 'OPENAI_API_KEY']) if (!env[k]) { console.error(`❌ .env 에 ${k} 없음`); process.exit(1); }

/* ---- Cartesia 합성(캐시 — 목소리까지 키에 넣어 speech-e2e 캐시와 섞이지 않게) ---- */
async function tts(text, lang) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, crypto.createHash('sha1').update(VOICE[lang] + ':' + lang + ':' + text).digest('hex').slice(0, 16) + '.pcm');
  if (fs.existsSync(f)) return { pcm: fs.readFileSync(f), cached: true };
  for (let a = 0; a < 3; a++) {
    const r = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: { 'X-API-Key': env.CARTESIA_API_KEY, 'Cartesia-Version': '2025-04-16', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: 'sonic-3.5', transcript: text, voice: { mode: 'id', id: VOICE[lang] }, language: lang, output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE } }),
    }).catch((e) => ({ ok: false, status: e.message, text: async () => '' }));
    if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(f, b); return { pcm: b, cached: false }; }
    console.error(`  ! Cartesia ${r.status} ${(await r.text()).slice(0, 120)}`);
    await sleep(1500);
  }
  throw new Error('Cartesia 합성 실패: ' + text.slice(0, 30));
}

/* ---- 세션 하나: 양방향 통역 세션을 만들고 대화를 실시간 속도로 흘려 넣기 ---- */
async function run(base, cookie) {
  const sess = await fetch(base + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: NAME, pipeline: 'soniox', preset: 'twoway', src: 'mic', inLang: 'auto' }) }).then((r) => r.json());
  if (!sess.id) throw new Error('세션 생성 실패: ' + JSON.stringify(sess));
  // 앱 양방향 통역(마이크 1개)과 같은 쿼리
  const q = `session=${sess.id}&src=mic&out=${A}&in=auto&pipeline=soniox&audioOut=${ECHO ? '1&tts=1&gender=f' : '0'}&sxSens=${opt('sens', 0)}&sxMaxDelay=${opt('max-delay', 2000)}&sxLatency=0&sxMode=two&sxTarget=en&sxA=${A}&sxB=${B}`;
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/host?${q}`, { headers: { Cookie: cookie } });
  const sent = new Map(); // id -> { id, firstAt, source, lang, texts, rawTexts(확정 직후 = 다듬기 전), final, removed }
  const statuses = [];
  let lastMsg = Date.now(), ready = false;
  // --echo: 서버가 이 기기로 보낸 TTS 음성을 '재생'했다고 보고(받은 순서대로 이어서, 0.15초 뒤) 마이크 입력에 섞는다
  const echo = []; let echoEnd = 0, sentSamples = 0;
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    lastMsg = Date.now();
    if (m.type === 'audio' && ECHO && m.b64) {
      const b = Buffer.from(m.b64, 'base64');
      const pcm = new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
      const start = Math.max(sentSamples + Math.round(0.15 * RATE), echoEnd);
      echo.push({ start, pcm }); echoEnd = start + pcm.length;
      return;
    }
    if (m.type === 'status') { statuses.push(m.message); if (/엔진 연결됨/.test(m.message)) ready = true; }
    if (m.type !== 'sentence') return;
    const s = sent.get(m.id) || { id: m.id, firstAt: Date.now() };
    // 빈 초안 = 고스트 카드 제거(잡음뿐·에코·중복) — 확정되지 않으면 보고서에서 뺀다
    if (m.draft && !m.source && !Object.keys(m.texts || {}).length) { s.removed = true; sent.set(m.id, s); return; }
    s.removed = false;
    s.source = m.source || s.source; s.lang = m.lang || s.lang;
    s.texts = { ...(s.texts || {}), ...(m.texts || {}) };
    if (!m.draft) { if (!s.final) s.rawTexts = { ...s.texts }; s.final = true; s.updates = (s.updates || 0) + 1; }
    sent.set(m.id, s);
  });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  for (const t = Date.now() + 15000; !ready && Date.now() < t;) await sleep(100); // 앱도 '엔진 연결됨' 뒤에 말하기 시작
  if (!ready) console.warn('  ! 엔진 연결 상태를 받지 못한 채 시작:', statuses.slice(-2).join(' | '));
  const CH = RATE / 10; // 100ms
  const t0 = Date.now();
  let samples = 0, lastAct = 0;
  const withEcho = (chunk, at) => {
    if (!echo.length) return chunk;
    const n = chunk.length >> 1, out = Buffer.from(chunk);
    for (const e of echo) {
      const a = Math.max(at, e.start), z = Math.min(at + n, e.start + e.pcm.length);
      for (let i = a; i < z; i++) {
        const v = out.readInt16LE((i - at) * 2) + e.pcm[i - e.start] * ECHO;
        out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), (i - at) * 2);
      }
    }
    while (echo.length && echo[0].start + echo[0].pcm.length <= at) echo.shift();
    return out;
  };
  const sendPcm = async (buf) => {
    for (let off = 0; off < buf.length; off += CH * 2) {
      ws.send(withEcho(buf.subarray(off, Math.min(buf.length, off + CH * 2)), samples));
      samples += Math.min(CH, (buf.length - off) / 2);
      sentSamples = samples;
      if (Date.now() - lastAct > 4000) { lastAct = Date.now(); ws.send(JSON.stringify({ type: 'activity' })); }
      const ahead = t0 + (samples / RATE) * 1000 - Date.now();
      if (ahead > 0) await sleep(ahead);
    }
  };
  const silence = (s) => Buffer.alloc(Math.round(RATE * s) * 2);
  for (const l of lines) {
    l.startAt = Date.now();
    await sendPcm(l.pcm);
    l.endAt = Date.now();
    await sendPcm(silence(GAP_S));
    process.stdout.write(`  ${l.i}/${lines.length}\r`);
  }
  await sendPcm(silence(3));
  ws.send(JSON.stringify({ type: 'stop' }));
  const until = Date.now() + 40000; // 확정·다듬기 도착 대기(8초 조용하면 끝)
  while (Date.now() < until && Date.now() - lastMsg < 8000) await sleep(500);
  ws.close();
  // 문장 → 줄: 처음 보인 시각이 그 줄 시작(+0.4초) 뒤인 마지막 줄
  const list = [...sent.values()].filter((s) => !s.removed && (s.source || Object.keys(s.texts || {}).length)).sort((a, b) => a.firstAt - b.firstAt);
  for (const s of list) {
    let owner = lines[0];
    for (const l of lines) if (l.startAt <= s.firstAt - 400) owner = l;
    s.lag = +((s.firstAt - owner.startAt) / 1000).toFixed(1);
    (owner.out = owner.out || []).push(s);
  }
  // TTS 가 사람 말로 잡힌 카드: 원문이 다른 카드의 번역(=읽어 준 TTS 문장)과 거의 같은 카드(잠깐 보였다 지워진 것 포함)
  const bigr = (x) => { const n = String(x || '').replace(/[\s\p{P}\p{S}]/gu, ''); const r = new Set(); for (let i = 0; i < n.length - 1; i++) r.add(n.slice(i, i + 2)); return r; };
  const ttsSets = [...sent.values()].filter((s) => s.final && !s.removed).flatMap((s) => Object.entries(s.texts || {}).filter(([k]) => k !== s.lang).map(([, v]) => bigr(v)));
  const echoCards = [...sent.values()].filter((s) => {
    const b = bigr(s.source); if (b.size < 3) return false;
    return ttsSets.some((t) => { let hit = 0; for (const x of b) if (t.has(x)) hit++; return hit / b.size >= 0.6; });
  });
  return { session: sess.id, statuses, sentences: list.length, removed: [...sent.values()].filter((s) => s.removed).length,
    echoShown: echoCards.length, echoKept: echoCards.filter((s) => s.final && !s.removed).length };
}

/* ---- 비교용: 공백·문장부호 뺀 글자 기준 편집 거리 비율 ---- */
function cer(ref, hyp) {
  const n = (s) => (s || '').replace(/[\s\p{P}\p{S}]/gu, '');
  const a = n(ref), b = n(hyp);
  if (!a.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / a.length;
}

console.log(`줄 ${lines.length}개 · ${chars}자 · ${A}⇄${B} — Cartesia 합성 중…`);
let fresh = 0;
for (const l of lines) { const r = await tts(l.text, l.speaker); l.pcm = r.pcm; l.sec = r.pcm.length / 2 / RATE; if (!r.cached) fresh += l.text.length; }
const totalSec = lines.reduce((a, l) => a + l.sec + GAP_S, 0);
console.log(`음성 ${(totalSec / 60).toFixed(1)}분(말 사이 무음 포함, 새로 합성 ${fresh}자) — 실시간 재생 시작`);

const srv = await bootServer({ SONIOX_API_KEY: env.SONIOX_API_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY, CARTESIA_API_KEY: ECHO ? env.CARTESIA_API_KEY : '', ...(NO_AGENT ? { SONIOX_AGENT_TEXT: '0' } : {}) });
let res;
try {
  const cookie = await loginAdmin(srv.base);
  if (TERMS) { // 기본 시드 뒤에 붙여 저장(격리 DATA_DIR) — 세션 연결 때 Soniox context 로 들어간다
    const cur = await fetch(srv.base + '/api/terms-config', { headers: { Cookie: cookie } }).then((r) => r.json());
    const r = await fetch(srv.base + '/api/terms-config', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ...cur, entries: [...cur.entries, ...TERMS] }) });
    if (!r.ok) throw new Error('용어 저장 실패: ' + r.status);
    console.log(`용어 ${TERMS.length}개 추가(전체 ${(await r.json()).entries.length}개)`);
  }
  res = await run(srv.base, cookie);
} finally {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, NAME + '.server.log'), srv.log());
  await srv.stop();
  fs.rmSync(srv.dataDir, { recursive: true, force: true }); // 테스트 세션·대화 기록 삭제(격리 DATA_DIR)
}

/* ---- 보고서 ---- */
const rows = lines.map((l) => {
  const out = l.out || [];
  const heard = out.map((s) => s.source || '').join(' ');
  const tr = (s, key) => (s[key] && s[key][other(s.lang || l.speaker)]) || '';
  return {
    i: l.i, speaker: l.speaker, script: l.text, sec: +l.sec.toFixed(1),
    heard, cer: +cer(l.text, heard).toFixed(3),
    langs: out.map((s) => s.lang || '?'),
    langOk: out.every((s) => s.lang === l.speaker),
    translated: out.map((s) => tr(s, 'texts')).join(' '),
    sentences: out.map((s) => ({ id: s.id, lag: s.lag, lang: s.lang || null, source: s.source || '', texts: s.texts || {}, raw: s.rawTexts || null, final: !!s.final })),
    notFinal: out.filter((s) => !s.final).length,
  };
});
// 같은 사람이 이어 말한 두 줄이 한 문장으로 확정되면(말 사이 1.2초 < 끊김 대기 최대 2초) 뒷줄은 비고 앞줄 오류율이 부푼다
// → 비어 있는 줄을 앞줄에 붙였을 때 오류율이 나아지면 '합쳐짐'으로 표시하고 합친 원문으로 다시 잰다
const byI = new Map(rows.map((r) => [r.i, r])); // --lines 로 일부만 돌리면 배열 위치 ≠ 줄 번호
for (let k = 1; k < rows.length; k++) {
  const r = rows[k];
  if (r.sentences.length) continue;
  let p = k - 1; while (p >= 0 && rows[p].mergedInto) p--;
  const prev = rows[p];
  if (!prev || !prev.sentences.length || prev.speaker !== r.speaker) continue;
  const joined = [prev.script, ...(prev.merged || []).map((i) => byI.get(i).script), r.script].join(' ');
  const c = cer(joined, prev.heard);
  if (c < prev.cer) { prev.merged = [...(prev.merged || []), r.i]; prev.cer = +c.toFixed(3); r.mergedInto = prev.i; }
}
const by = (g) => rows.filter((r) => r.speaker === g && !r.mergedInto);
const scriptLen = (r) => r.script.length + (r.merged || []).reduce((a, i) => a + byI.get(i).script.length, 0);
const avgCer = (rs) => { const n = rs.reduce((a, r) => a + scriptLen(r), 0); return n ? rs.reduce((a, r) => a + r.cer * scriptLen(r), 0) / n : 0; };
const lags = rows.filter((r) => r.sentences.length).map((r) => r.sentences[0].lag).sort((a, b) => a - b);
const allS = rows.flatMap((r) => r.sentences.map((s) => ({ ...s, speaker: r.speaker })));
const wrongLang = allS.filter((s) => s.lang !== s.speaker);
const summary = {
  echoDb: ECHO_DB, agentText: ECHO ? !NO_AGENT : null, echoShown: res.echoShown, echoKept: res.echoKept,
  pair: `${A}⇄${B}`, audioMin: +(totalSec / 60).toFixed(1), lines: lines.length, chars, sentences: allS.length,
  cer: Object.fromEntries(langs.map((g) => [g, +avgCer(by(g)).toFixed(3)])),
  wrongLang: wrongLang.length, missingLines: rows.filter((r) => !r.sentences.length && !r.mergedInto).map((r) => r.i),
  mergedLines: rows.filter((r) => r.mergedInto).map((r) => `${r.mergedInto}+${r.i}`),
  firstTextLagMedianS: lags.length ? lags[Math.floor(lags.length / 2)] : null,
  polished: allS.filter((s) => s.raw && JSON.stringify(s.raw) !== JSON.stringify(s.texts)).length,
  notFinal: allS.filter((s) => !s.final).length,
};
fs.writeFileSync(path.join(OUT, NAME + '.json'), JSON.stringify({ title: scen.title || NAME, lines: opt('lines') || 'all', terms: TERMS, summary, run: res, rows }, null, 1));

const flag = (r) => (r.cer > 0.15 ? ` ⚠ 오류율 ${(r.cer * 100).toFixed(0)}%` : '');
let md = `# ${scen.title || NAME}\n\n`;
md += `- 양방향 통역 ${LANG_NAME[A] || A} ⇄ ${LANG_NAME[B] || B} (soniox two_way, 마이크 1개·모노, 입력 언어 자동), 음성 ${summary.audioMin}분, ${lines.length}줄, 확정 문장 ${allS.length}개\n`;
md += `- 인식 글자 오류율(공백·문장부호 제외): ${langs.map((g) => `${LANG_NAME[g] || g} ${(summary.cer[g] * 100).toFixed(1)}%`).join(' · ')}\n`;
md += `- 언어 판정 틀림: ${wrongLang.length}문장${wrongLang.length ? ` (${rows.filter((r) => !r.langOk && r.sentences.length).map((r) => r.i + '번').join(', ')})` : ''} · 인식 안 된 줄: ${summary.missingLines.length ? summary.missingLines.join(', ') + '번' : '없음'} · 한 문장으로 합쳐진 줄: ${summary.mergedLines.length ? summary.mergedLines.join(', ') : '없음'} · 다듬기로 바뀐 문장: ${summary.polished}개\n`;
if (ECHO) md += `- 스피커 소리 섞음 -${ECHO_DB}dB, 에이전트 텍스트 ${NO_AGENT ? '끔' : '켬'}: TTS 가 사람 말로 잡힌 카드 ${res.echoShown}개(그중 남은 카드 ${res.echoKept}개)\n`;
md += `- 말 시작 → 화면에 첫 글자: 줄별 중앙값 ${summary.firstTextLagMedianS}초\n`;
if (pick) md += `- 재생한 줄: ${opt('lines')}번만\n`;
if (TERMS) md += `- 테스트 용어 ${TERMS.length}개 추가(기본 시드 + \`${path.relative(ROOT, path.resolve(opt('terms')))}\`): ${TERMS.map((t) => `${t.names.ko}⇄${t.names.ja || t.names.en || ''}`).join(', ')}\n`;
md += `- 문장 쪼개짐은 ‖ 로 표시. ⓡ = 다듬기 전 번역(Soniox 원 번역)이 화면 최종 번역과 다를 때만 표시. 오류율에는 숫자 표기 차이(백→100 등)도 들어간다\n\n`;
for (const r of rows) {
  const who = r.speaker === 'ko' ? '한국측' : r.speaker === 'ja' ? '일본측' : r.speaker;
  md += `## ${r.i}. ${who} (${LANG_NAME[r.speaker] || r.speaker})\n\n`;
  md += `**시나리오** ${r.script}\n\n`;
  if (r.mergedInto) { md += `**인식** ${r.mergedInto}번 줄과 한 문장으로 확정됨(위 ${r.mergedInto}번 참고)\n\n---\n\n`; continue; }
  if (!r.sentences.length) { md += `**인식** (없음) ⚠\n\n---\n\n`; continue; }
  if (r.merged) md += `*(다음 줄 ${r.merged.join('·')}번까지 한 문장으로 확정됨)*\n\n`;
  md += `**인식** ${r.sentences.map((s) => s.source).join(' ‖ ')}${flag(r)}\n\n`;
  md += `**판정 언어** ${r.sentences.map((s) => (s.lang === r.speaker ? s.lang : `⚠${s.lang || '?'}`)).join(' · ')}\n\n`;
  md += `**번역** ${r.sentences.map((s) => s.texts[other(s.lang || r.speaker)] || '(없음)').join(' ‖ ')}\n\n`;
  const raws = r.sentences.filter((s) => s.raw && s.raw[other(s.lang || r.speaker)] !== s.texts[other(s.lang || r.speaker)]);
  if (raws.length) md += `ⓡ ${raws.map((s) => s.raw[other(s.lang || r.speaker)] || '(없음)').join(' ‖ ')}\n\n`;
  md += `---\n\n`;
}
fs.writeFileSync(path.join(OUT, NAME + '.md'), md);
console.log(`\n완료: tools/eval/out/${NAME}.md · 문장 ${allS.length}개 · 오류율 ${langs.map((g) => `${g} ${(summary.cer[g] * 100).toFixed(1)}%`).join(' ')} · 언어 판정 틀림 ${wrongLang.length}`);
console.log(`  상태: ${res.statuses.filter((s) => !/엔진 연결됨/.test(s)).slice(-3).join(' | ') || '정상'} · 제거된 카드 ${res.removed}`);
