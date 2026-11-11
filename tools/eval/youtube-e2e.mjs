/* 유튜브 영상(브라우저에서 실제 재생) → 영상 소리 캡처 → 우리 서버(실제 Soniox 인식·번역 + 다듬기) → 문장별 보고서.
   앱의 '시스템 오디오' 입력(PC 에서 재생하는 영상 번역)과 같은 상황을 재현한다. 광고 구간은 건너뛰고 보내지 않는다.
   사용: node tools/eval/youtube-e2e.mjs <유튜브 주소|영상 ID> [--from zh] [--to ko] [--terms 용어.json] [--name 이름] [--headless] [--max-sec 600]
   출력: tools/eval/out/<이름>.md·.json (git 무시)
   ⚠ 과금: Soniox(실시간 인식·번역)·OpenAI(다듬기). 브라우저는 이 PC 의 Edge 를 쓴다(다운로드 없음). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { chromium } from 'playwright';
import { bootServer, loginAdmin } from '../../test/helpers/boot.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');
const OUT = path.join(DIR, 'out');
const RATE = 24000;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const target = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!target) { console.error('사용: node tools/eval/youtube-e2e.mjs <유튜브 주소|ID> [--from zh] [--to ko]'); process.exit(1); }
const ID = (target.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/) || [, target])[1];
const FROM = opt('from', 'zh'), TO = opt('to', 'ko');
const NAME = opt('name', `yt-${ID}-${TO}`);
const MAX_SEC = Number(opt('max-sec', 600));
const TERMS = opt('terms') ? opt('terms').split(',').flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8'))) : null; // 여러 파일은 쉼표로
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
for (const k of ['SONIOX_API_KEY', 'OPENAI_API_KEY']) if (!env[k]) { console.error(`❌ .env 에 ${k} 없음`); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const srv = await bootServer({ SONIOX_API_KEY: env.SONIOX_API_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY, CARTESIA_API_KEY: '' });
const browser = await chromium.launch({ channel: 'msedge', headless: args.includes('--headless'), args: ['--autoplay-policy=no-user-gesture-required'] });
let report;
try {
  const cookie = await loginAdmin(srv.base);
  if (TERMS) {
    const cur = await fetch(srv.base + '/api/terms-config', { headers: { Cookie: cookie } }).then((r) => r.json());
    const r = await fetch(srv.base + '/api/terms-config', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ...cur, entries: [...cur.entries, ...TERMS] }) });
    if (!r.ok) throw new Error('용어 저장 실패: ' + r.status);
    console.log(`용어 ${TERMS.length}개 추가`);
  }
  const sess = await fetch(srv.base + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: NAME, pipeline: 'soniox', preset: 'oneway', src: 'mic', inLang: FROM }) }).then((r) => r.json());
  const q = `session=${sess.id}&src=mic&out=${TO}&in=${FROM}&pipeline=soniox&audioOut=0&sxSens=0&sxMaxDelay=2000&sxLatency=0&sxMode=one&sxTarget=${TO}`;
  const ws = new WebSocket(`${srv.base.replace('http', 'ws')}/ws/host?${q}`, { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

  // 영상 시각 ↔ 실제 시각(문장이 처음 보인 때의 영상 위치를 적기 위해)
  let vNow = 0, sentBytes = 0, lastAct = 0, lastMsg = Date.now();
  const sent = new Map();
  const statuses = [];
  const level = []; // 영상 1초마다 최대 소리 크기(캡처가 무음이 됐는지 확인용)
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    lastMsg = Date.now();
    if (m.type === 'status' || m.type === 'error') statuses.push(`[${mmss(vNow)}] ${m.type}: ${m.message || m.error || JSON.stringify(m).slice(0, 120)}`);
    if (m.type !== 'sentence') return;
    const s = sent.get(m.id) || { id: m.id, firstV: vNow };
    s.source = m.source || s.source; s.texts = m.texts || s.texts;
    if (!m.draft && !s.final) { s.final = true; s.rawTexts = m.texts; }
    sent.set(m.id, s);
  });

  const page = await (await browser.newContext({ locale: 'ko-KR', viewport: { width: 1100, height: 760 } })).newPage();
  let ended = false;
  await page.exposeFunction('__ytPcm', (b64, t) => {
    const buf = Buffer.from(b64, 'base64');
    { let pk = 0; for (let i = 0; i < buf.length; i += 2) { const v = Math.abs(buf.readInt16LE(i)); if (v > pk) pk = v; } const sec = Math.floor(t); level[sec] = Math.max(level[sec] || 0, pk); }
    if (ws.readyState === 1) ws.send(buf);
    sentBytes += buf.length; vNow = t;
    if (Date.now() - lastAct > 4000 && ws.readyState === 1) { lastAct = Date.now(); ws.send(JSON.stringify({ type: 'activity' })); }
  });
  await page.exposeFunction('__ytEnded', () => { ended = true; });
  await page.goto('https://www.youtube.com/watch?v=' + ID, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('video', { timeout: 30000 });
  // 광고: 건너뛰기 버튼이 있으면 누르고, 끝날 때까지 기다린다
  for (let i = 0; i < 240; i++) {
    const ad = await page.evaluate(() => {
      const mp = document.querySelector('#movie_player');
      const on = !!(mp && mp.classList.contains('ad-showing'));
      if (on) { const b = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button'); if (b) b.click(); }
      return on;
    });
    if (!ad) break;
    await sleep(500);
  }
  const info = await page.evaluate(() => ({ title: (document.querySelector('h1 yt-formatted-string') || {}).textContent || document.title, dur: document.querySelector('video').duration }));
  console.log(`재생: ${info.title} (${mmss(info.dur || 0)})`);
  // 처음부터 다시 재생하며 캡처(영상 소리 → 24kHz 모노 PCM16 → 서버)
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.pause(); v.currentTime = 0; v.loop = false;
    const ctx = new AudioContext({ sampleRate: 24000 });
    const src = ctx.createMediaStreamSource(v.captureStream());
    const proc = ctx.createScriptProcessor(4096, 2, 1);
    src.connect(proc); proc.connect(ctx.destination); // 출력은 0(무음) — 소리는 영상이 그대로 낸다
    proc.onaudioprocess = (e) => {
      const mp = document.querySelector('#movie_player');
      if (v.paused || (mp && mp.classList.contains('ad-showing'))) return;
      const ib = e.inputBuffer, n = ib.length, ch = ib.numberOfChannels;
      const i16 = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        let x = 0; for (let c = 0; c < ch; c++) x += ib.getChannelData(c)[i];
        x /= ch; i16[i] = Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
      }
      const u8 = new Uint8Array(i16.buffer); let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      window.__ytPcm(btoa(s), v.currentTime);
    };
    v.addEventListener('ended', () => window.__ytEnded());
    window.__ytCtx = ctx;
    v.play();
  });
  const t0 = Date.now();
  while (!ended && Date.now() - t0 < Math.min(MAX_SEC, (info.dur || MAX_SEC) + 30) * 1000) {
    await sleep(500);
    process.stdout.write(`  ${mmss(vNow)} / ${mmss(info.dur || 0)} · 문장 ${sent.size}\r`);
    // 중간 광고·멈춤 대비: 멈춰 있으면 다시 재생
    if (Date.now() - t0 > 5000) await page.evaluate(() => { const v = document.querySelector('video'); const mp = document.querySelector('#movie_player'); if (v.paused && !v.ended && !(mp && mp.classList.contains('ad-showing'))) v.play(); }).catch(() => {});
  }
  // 끝: 무음 3초 → 중지 → 확정·다듬기 도착 대기
  for (let i = 0; i < 30; i++) { ws.send(Buffer.alloc(RATE / 10 * 2)); await sleep(100); }
  ws.send(JSON.stringify({ type: 'stop' }));
  const until = Date.now() + 40000;
  while (Date.now() < until && Date.now() - lastMsg < 8000) await sleep(500);
  ws.close();
  const list = [...sent.values()].sort((a, b) => a.firstV - b.firstV);
  report = { statuses, level: level.map((x) => x || 0), id: ID, url: 'https://www.youtube.com/watch?v=' + ID, title: info.title, dur: info.dur, from: FROM, to: TO, audioSec: +(sentBytes / 2 / RATE).toFixed(1), terms: TERMS ? TERMS.length : 0,
    rows: list.map((s) => ({ at: +s.firstV.toFixed(1), source: s.source || '', text: (s.texts && s.texts[TO]) || '', raw: (s.rawTexts && s.rawTexts[TO]) || '', final: !!s.final })) };
} finally {
  await browser.close().catch(() => {});
  await srv.stop();
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, NAME + '.json'), JSON.stringify(report, null, 1));
let md = `# ${report.title}\n\n- ${report.url} · 영상 ${mmss(report.dur || 0)} · 보낸 소리 ${report.audioSec}초 · ${FROM} → ${TO} · 문장 ${report.rows.length}개${report.terms ? ` · 테스트 용어 ${report.terms}개 추가` : ''}\n- 시각 = 그 문장이 화면에 처음 보인 때의 영상 위치. '다듬기 전'은 다듬기로 바뀐 문장만 표시\n\n`;
for (const r of report.rows) {
  md += `**[${mmss(r.at)}]** ${r.source}\n\n→ ${r.text}${r.final ? '' : ' (확정 안 됨)'}\n\n`;
  if (r.raw && r.raw !== r.text) md += `　다듬기 전: ${r.raw}\n\n`;
}
const quiet = report.level.map((x, i) => (x < 300 ? i : -1)).filter((i) => i >= 0);
md += `
---
- 서버 상태 메시지: ${report.statuses.length ? report.statuses.join(' / ') : '없음'}
- 소리가 거의 없던 초(최대 진폭 300 미만): ${quiet.length}초${quiet.length ? ` (${quiet.slice(0, 20).map(mmss).join(', ')}${quiet.length > 20 ? ' …' : ''})` : ''}
`;
fs.writeFileSync(path.join(OUT, NAME + '.md'), md);
console.log(`\n완료: tools/eval/out/${NAME}.md · 문장 ${report.rows.length}개 · 보낸 소리 ${report.audioSec}초`);
