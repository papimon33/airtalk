/* 카드 글자가 바뀔 때의 화면 처리 — 진행 중 글자는 살짝 떠오르며 붙고, 감수로 문장이 바뀌면 바뀐 낱말만 잠깐 강조한다.
   (이전: 글자가 통째로 바뀌어 읽던 자리를 잃었다. 2026-11-12 화면 관찰)
   뷰어(client/public/viewer/join.html)는 같은 규칙을 바닐라 JS 로 따로 갖고 있다 — 고치면 양쪽을 함께 고칠 것. */
import React, { useRef } from 'react';
import Typography from '@mui/material/Typography';

const CSS = `
@keyframes at-in { from { opacity: .25 } to { opacity: 1 } }
@keyframes at-swap { from { opacity: .5 } to { opacity: 1 } }
@keyframes at-chg { 0% { background-color: rgba(91,76,240,.30) } 100% { background-color: rgba(91,76,240,0) } }
.at-in { animation: at-in .28s ease-out both }
.at-swap { animation: at-swap .3s ease-out both }
.at-chg { animation: at-chg 2.4s ease-out both; border-radius: 4px; -webkit-box-decoration-break: clone; box-decoration-break: clone }
.at-src1 { display: flex; justify-content: flex-end; overflow: hidden; white-space: nowrap; -webkit-mask-image: linear-gradient(to right, transparent 0, #000 28px); mask-image: linear-gradient(to right, transparent 0, #000 28px) }
.at-src1 > span { flex: none; min-width: 100% }
.at-src1.at-rtl { -webkit-mask-image: linear-gradient(to left, transparent 0, #000 28px); mask-image: linear-gradient(to left, transparent 0, #000 28px) }
@media (prefers-reduced-motion: reduce) { .at-in, .at-swap, .at-chg { animation: none } }
`;
if (typeof document !== 'undefined' && !document.getElementById('at-live-css')) {
  const st = document.createElement('style'); st.id = 'at-live-css'; st.textContent = CSS; document.head.appendChild(st);
}

// 낱말 단위 비교: 한자·가나는 글자 하나씩, 그 밖은 띄어쓰기 단위(뒤 공백 포함)
const TOK = /[぀-ヿ㐀-鿿豈-﫿]|[^\s぀-ヿ㐀-鿿豈-﫿]+\s*|\s+/g;
// 새 문장을 [{ t, c }] 로 — c: 이전 문장에 없던(바뀐) 부분
export function diffMarks(a, b) {
  const A = String(a || '').match(TOK) || [], B = String(b || '').match(TOK) || [];
  const n = A.length, m = B.length;
  if (!n || !m || n * m > 90000) return [{ t: String(b || ''), c: false }]; // 너무 길면 강조 없이
  const ka = A.map((x) => x.trim()), kb = B.map((x) => x.trim());
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  const push = (t, c) => { const l = out[out.length - 1]; if (l && l.c === c) l.t += t; else out.push({ t, c }); };
  for (let i = 0, j = 0; j < m;) {
    if (i < n && ka[i] === kb[j]) { push(B[j], false); i++; j++; }
    else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else { push(B[j], !!kb[j]); j++; }
  }
  return out;
}

let stamp = 0;
/* 번역문 한 덩어리. text 가 바뀌면:
   - 진행 중에 뒤에 붙음 → 새로 붙은 글자만 떠오르듯 나타남
   - 확정된 뒤 바뀜(감수) → 전체가 살짝 다시 나타나고, 바뀐 낱말은 2초쯤 옅게 강조
   - 그 밖(첫 표시·진행 중 앞부분 교체·확정) → 그대로 */
export function LiveText({ text, draft, sx, ...rest }) {
  const prev = useRef({ text: '', draft: true, view: null });
  const p = prev.current;
  const cur = String(text || '');
  if (cur !== p.text) {
    let view = null;
    if (p.text && !draft && !p.draft) view = { mode: 'swap', segs: diffMarks(p.text, cur), key: ++stamp };
    else if (p.text && draft && p.draft && cur.startsWith(p.text)) view = { mode: 'append', base: p.text, add: cur.slice(p.text.length) };
    prev.current = { text: cur, draft: !!draft, view };
  } else if (!!draft !== p.draft) {
    prev.current = { ...p, draft: !!draft, view: p.view && p.view.mode === 'swap' ? p.view : null };
  }
  const v = prev.current.view;
  let body = cur;
  if (v && v.mode === 'append') body = <>{v.base}<span key={cur.length} className="at-in">{v.add}</span></>;
  else if (v && v.mode === 'swap') body = <span key={v.key} className="at-swap">{v.segs.map((s, i) => (s.c ? <span key={i} className="at-chg">{s.t}</span> : s.t))}</span>;
  return <Typography dir="auto" sx={{ transition: 'color .25s', ...sx }} {...rest}>{body}</Typography>;
}

/* 맨 아래 붙어 보기 — 줄이 늘 때 화면이 뚝 밀리지 않게 조금씩 따라 내려간다.
   한꺼번에 많이 늘었거나(처음 불러올 때) 움직임 줄이기 설정이면 바로 이동. */
const pins = new WeakMap();
export function pinBottom(el) {
  if (!el) return;
  const target = () => el.scrollHeight - el.clientHeight;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || target() - el.scrollTop > el.clientHeight * 1.5) { el.scrollTop = target(); return; }
  let st = pins.get(el);
  if (!st) { st = { raf: 0 }; pins.set(el, st); }
  if (st.raf) return; // 이미 따라가는 중 — 목표는 매 프레임 다시 읽는다
  const step = () => {
    const d = target() - el.scrollTop;
    if (d <= 0.5) { el.scrollTop = target(); st.raf = 0; return; }
    el.scrollTop += Math.max(1, d * 0.22);
    st.raf = requestAnimationFrame(step);
  };
  st.raf = requestAnimationFrame(step);
}

/* 진행 중인 카드의 원문 표시 방식 — 기본은 끝부분만 한 줄(line): 번역문과 원문이 함께 자라며 화면이 두 번 밀리던 것을 줄인다.
   비교용: 주소에 ?srcDraft=full(전체) | hide(숨김) | line(기본) 을 붙이면 이 브라우저에 기억한다 */
export function srcDraftMode() {
  try {
    const q = new URLSearchParams(window.location.search).get('srcDraft');
    if (q === 'hide' || q === 'full') localStorage.setItem('kac-demo-srcdraft', q);
    else if (q === 'line') localStorage.removeItem('kac-demo-srcdraft');
    const v = localStorage.getItem('kac-demo-srcdraft');
    return v === 'hide' || v === 'full' ? v : 'line';
  } catch { return 'line'; }
}
const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFEFC]/; // 히브리·아랍 글자
// 원문 줄: 진행 중에는 끝부분만 한 줄로(확정되면 전체). 비교용 설정이면 숨기거나 전체로
export function SourceLine({ text, draft, sx, ...rest }) {
  const mode = draft ? srcDraftMode() : 'full';
  if (mode === 'hide') return null;
  if (mode === 'line') {
    // 아랍어·히브리어는 오른쪽에서 왼쪽으로 쓴다 — 방향을 알려 줘야 '끝부분'(왼쪽)이 보인다(안 그러면 첫머리만 보여 멈춘 것처럼 보였다)
    const rtl = RTL_RE.test(String(text || ''));
    return <Typography className={rtl ? 'at-src1 at-rtl' : 'at-src1'} dir={rtl ? 'rtl' : undefined} sx={sx} {...rest}><span>{text}</span></Typography>;
  }
  return <Typography dir="auto" sx={sx} {...rest}>{text}</Typography>; // dir=auto: 아랍어 원문은 오른쪽 정렬·부호 자리가 맞게(뷰어와 같다)
}
