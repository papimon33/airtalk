/* 오디오 파일(mp3·wav 등) → 우리 서버(실제 Soniox 인식·번역 + 다듬기)에 실시간 속도로 흘려 넣기 → 문장별 보고서.
   앱의 '시스템 오디오'·마이크 입력과 같은 경로(단방향 실시간 번역 세션). 파일 여러 개는 세션을 따로 열어 동시에 돌린다.
   사용: node tools/eval/audio-e2e.mjs <파일...> [--from zh] [--to ko] [--terms 용어.json] [--prefix 이름]
   ffmpeg 필요(PATH 또는 FFMPEG 환경변수). 출력: tools/eval/out/<이름>.md·.json (git 무시)
   ⚠ 과금: Soniox(실시간 인식·번역)·OpenAI(다듬기). */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { bootServer, loginAdmin } from '../../test/helpers/boot.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');
const OUT = path.join(DIR, 'out');
const RATE = 24000;
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const files = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!files.length) { console.error('사용: node tools/eval/audio-e2e.mjs <파일...> [--from zh] [--to ko] [--terms 용어.json]'); process.exit(1); }
const FROM = opt('from', 'zh'), TO = opt('to', 'ko'), PREFIX = opt('prefix', 'audio');
const TERMS = opt('terms') ? opt('terms').split(',').flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8'))) : null; // 여러 파일은 쉼표로
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
for (const k of ['SONIOX_API_KEY', 'OPENAI_API_KEY']) if (!env[k]) { console.error(`❌ .env 에 ${k} 없음`); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// 파일 → 24kHz 모노 PCM16
const jobs = files.map((f, k) => {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', f, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg 실패: ' + f + ' ' + String(r.stderr).slice(0, 200));
  return { k, file: f, title: path.basename(f).replace(/\.[^.]+$/, ''), pcm: r.stdout, sec: r.stdout.length / 2 / RATE, name: `${PREFIX}-${k + 1}` };
});
for (const j of jobs) console.log(`#${j.k + 1} ${mmss(j.sec)} ${j.title}`);

async function run(base, cookie, job) {
  const sess = await fetch(base + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: job.name, pipeline: 'soniox', preset: 'oneway', src: 'mic', inLang: FROM }) }).then((r) => r.json());
  const q = `session=${sess.id}&src=mic&out=${TO}&in=${FROM}&pipeline=soniox&audioOut=0&sxSens=0&sxMaxDelay=2000&sxLatency=0&sxMode=one&sxTarget=${TO}`;
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/host?${q}`, { headers: { Cookie: cookie } });
  const sent = new Map(), statuses = [];
  let lastMsg = Date.now(), t0 = 0;
  const pos = () => (t0 ? (Date.now() - t0) / 1000 : 0);
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    lastMsg = Date.now();
    if (m.type === 'status' || m.type === 'error') statuses.push(`[${mmss(pos())}] ${m.message || m.error || ''}`);
    if (m.type !== 'sentence') return;
    const s = sent.get(m.id) || { id: m.id, firstAt: pos() };
    s.source = m.source || s.source; s.texts = m.texts || s.texts;
    if (!m.draft && !s.final) { s.final = true; s.rawTexts = m.texts; s.finalAt = pos(); }
    sent.set(m.id, s);
  });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const CH = RATE / 10; // 100ms
  t0 = Date.now();
  let samples = 0, lastAct = 0;
  const pcm = Buffer.concat([job.pcm, Buffer.alloc(RATE * 3 * 2)]); // 끝에 무음 3초
  for (let off = 0; off < pcm.length; off += CH * 2) {
    ws.send(pcm.subarray(off, Math.min(pcm.length, off + CH * 2)));
    samples += Math.min(CH, (pcm.length - off) / 2);
    if (Date.now() - lastAct > 4000) { lastAct = Date.now(); ws.send(JSON.stringify({ type: 'activity' })); }
    const ahead = t0 + (samples / RATE) * 1000 - Date.now();
    if (ahead > 0) await sleep(ahead);
  }
  ws.send(JSON.stringify({ type: 'stop' }));
  const until = Date.now() + 40000;
  while (Date.now() < until && Date.now() - lastMsg < 8000) await sleep(500);
  ws.close();
  const rows = [...sent.values()].sort((a, b) => a.firstAt - b.firstAt).map((s) => ({
    at: +s.firstAt.toFixed(1), lag: s.finalAt != null ? +(s.finalAt - s.firstAt).toFixed(1) : null, source: s.source || '',
    text: (s.texts && s.texts[TO]) || '', raw: (s.rawTexts && s.rawTexts[TO]) || '', final: !!s.final }));
  return { ...job, pcm: undefined, statuses, rows };
}

const srv = await bootServer({ SONIOX_API_KEY: env.SONIOX_API_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY, CARTESIA_API_KEY: '' });
let results;
try {
  const cookie = await loginAdmin(srv.base);
  if (TERMS) {
    const cur = await fetch(srv.base + '/api/terms-config', { headers: { Cookie: cookie } }).then((r) => r.json());
    const r = await fetch(srv.base + '/api/terms-config', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ...cur, entries: [...cur.entries, ...TERMS] }) });
    if (!r.ok) throw new Error('용어 저장 실패: ' + r.status);
    console.log(`용어 ${TERMS.length}개 추가`);
  }
  console.log(`세션 ${jobs.length}개 동시 실시간 재생 — 약 ${mmss(Math.max(...jobs.map((j) => j.sec)) + 3)}`);
  results = await Promise.all(jobs.map((j) => run(srv.base, cookie, j)));
} finally {
  await srv.stop();
}

fs.mkdirSync(OUT, { recursive: true });
for (const r of results) {
  fs.writeFileSync(path.join(OUT, r.name + '.json'), JSON.stringify(r, null, 1));
  let md = `# ${r.title}\n\n- 파일 ${path.basename(r.file)} · ${mmss(r.sec)} · ${FROM} → ${TO} · 문장 ${r.rows.length}개${TERMS ? ` · 테스트 용어 ${TERMS.length}개 추가` : ''}\n- 시각 = 그 문장이 화면에 처음 보인 때의 재생 위치. '다듬기 전'은 다듬기로 바뀐 문장만 표시\n\n`;
  for (const x of r.rows) {
    md += `**[${mmss(x.at)}]** ${x.source}\n\n→ ${x.text}${x.final ? '' : ' (확정 안 됨)'}\n\n`;
    if (x.raw && x.raw !== x.text) md += `　다듬기 전: ${x.raw}\n\n`;
  }
  md += `---\n- 서버 상태: ${r.statuses.join(' / ') || '없음'}\n`;
  fs.writeFileSync(path.join(OUT, r.name + '.md'), md);
  console.log(`완료: tools/eval/out/${r.name}.md · 문장 ${r.rows.length}개`);
}
