/* 지명 번역 채점 — speech-e2e 보고서(json) + 지명표(scenarios/places.json)
   지명마다 [대본에 있나 / 인식됐나 / 다듬기 전 번역에 맞는 표기가 있나 / 최종 번역에 있나]를 본다.
   사용: node tools/eval/score-places.mjs <보고서.json> [--places tools/eval/scenarios/places.json] [--name 이름]
   한국어 짧은 지명('빈'·'인도'·'지난' 등)은 단어 경계로 본다(하얼빈·인도네시아·지난해에 걸리지 않게). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const rep = JSON.parse(fs.readFileSync(file, 'utf8'));
const places = JSON.parse(fs.readFileSync(opt('places', path.join(DIR, 'scenarios', 'places.json')), 'utf8'));
const NAME = opt('name', path.basename(file, '.json') + '-places');
const FROM = rep.from, TO = rep.to;
const join = (k) => rep.rows.map((r) => r[k] || '').join('\n');
const text = { script: join('script'), heard: join('heard'), raw: join('raw'), final: join('translated') };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PART = '(?:와|과|은|는|이|가|을|를|의|에서|에|도|로|으로|까지|부터|입니다|이며|이고|이죠|등|과의|와의|행|발|노선|공항|시)?';
function has(hay, name, lang) {
  if (lang === 'ko') {
    const n = esc(name).replace(/[·\s]+/g, '[·\\s,、-]*');
    return new RegExp(`(?<![가-힣])${n}${PART}(?![가-힣])`).test(hay);
  }
  const sq = (x) => x.replace(/[\s·、，,-]/g, '');
  const h = sq(hay), k = sq(name);
  if (k === '印度') return /印度(?!尼)/.test(h);
  if (k === '蒙古') return /(?<!内)蒙古/.test(h);
  return h.includes(k);
}
const any = (hay, list, lang) => list.some((v) => has(hay, v, lang));

const rows = [];
for (const p of places) {
  const src = p[FROM], tgt = p[TO];
  if (!src || !tgt || !any(text.script, src, FROM)) continue; // 이 방향 대본에 없는 지명
  const expect = p.abbr && TO === 'ko' && p.expect ? p.expect : null;
  const ok = (hay) => (expect ? expect.every((v) => has(hay, v, TO)) : false) || any(hay, tgt, TO);
  rows.push({ cat: p.cat, src: src[0], tgt: tgt[0], heard: any(text.heard, src, FROM), raw: ok(text.raw || text.final), final: ok(text.final) });
}
const cats = [...new Set(rows.map((r) => r.cat))];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + '%';
let md = `# 지명 번역 채점 — ${path.basename(file, '.json')} (${FROM} → ${TO})\n\n` +
  `- 대본의 지명 ${rows.length}개 · 인식 ${pct(rows.filter((r) => r.heard).length, rows.length)} · 다듬기 전 번역 ${pct(rows.filter((r) => r.raw).length, rows.length)} · 최종 번역 ${pct(rows.filter((r) => r.final).length, rows.length)}\n\n` +
  '| 분류 | 지명 수 | 인식 | 다듬기 전 | 최종 |\n|---|---|---|---|---|\n';
for (const c of cats) {
  const rs = rows.filter((r) => r.cat === c);
  md += `| ${c} | ${rs.length} | ${pct(rs.filter((r) => r.heard).length, rs.length)} | ${pct(rs.filter((r) => r.raw).length, rs.length)} | ${pct(rs.filter((r) => r.final).length, rs.length)} |\n`;
}
const miss = rows.filter((r) => !r.heard || !r.final || !r.raw);
md += `\n## 틀리거나 빠진 지명 ${miss.length}개\n\n| 지명 | 기대 표기 | 인식 | 다듬기 전 | 최종 |\n|---|---|---|---|---|\n`;
for (const r of miss) md += `| ${r.src} | ${r.tgt} | ${r.heard ? '○' : '✗'} | ${r.raw ? '○' : '✗'} | ${r.final ? '○' : '✗'} |\n`;
const OUT = path.join(DIR, 'out');
fs.writeFileSync(path.join(OUT, NAME + '.md'), md);
fs.writeFileSync(path.join(OUT, NAME + '.json'), JSON.stringify(rows, null, 1));
console.log(md.split('\n## ')[0]);
console.log(`틀리거나 빠진 지명: ${miss.map((r) => `${r.src}(${r.heard ? '' : '인식✗ '}${r.raw ? '' : '전✗ '}${r.final ? '' : '후✗'})`.replace(/ \)/, ')')).join(', ')}`);
