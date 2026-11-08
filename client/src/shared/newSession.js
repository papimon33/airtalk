/* 새 세션의 언어 고르기 — 폰(단계별 시트)과 PC(한 화면 창)가 같은 값·같은 저장 방식을 쓴다. */
import { useEffect, useState } from 'react';
import { usePrefs } from './prefs.js';
import { SX_LANGS } from '../session/TranslateView.jsx';

const SX_CODES = SX_LANGS.map((l) => l.code);
const IN_CODES = ['auto', ...SX_CODES]; // 자동 감지 + 지원하는 모든 언어 — 실시간 번역의 입력 언어 힌트
const p2 = (n) => String(n).padStart(2, '0');

// 이름을 비워 두면 쓰는 기본 이름(날짜·시각 + 모드)
export function defaultName(mode, t) {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())} ${mode === 'twoway' ? t('modeTwoway') : t('modeOneway')}`;
}

export function useSessionLangs(open) {
  const prefs = usePrefs();
  const [src, setSrc] = useState('auto');      // 실시간 번역: 입력 언어(자동 감지 기본)
  const [target, setTarget] = useState('ko');  // 실시간 번역: 출력 언어(모국어 기본)
  const [a, setA] = useState('ko');            // 양방향: 내 언어(모국어 기본)
  const [b, setB] = useState('en');            // 양방향: 상대 언어(지난번 값)
  useEffect(() => {
    if (!open) return;
    const nat = prefs.nativeLang || 'ko';
    let lastB = null;
    try { lastB = localStorage.getItem('kac-sx-b'); } catch {}
    setSrc('auto');
    setTarget(nat);
    setA(nat);
    setB(lastB && lastB !== nat ? lastB : nat === 'en' ? 'ko' : 'en');
    // eslint-disable-next-line
  }, [open]);
  const boxes = (mode, t) => (mode === 'oneway'
    ? [{ k: 'src', caption: t('inputLang'), title: t('nsSrc'), value: src, codes: IN_CODES }, { k: 'target', caption: t('outputLang'), title: t('nsTarget'), value: target, codes: SX_CODES }]
    : [{ k: 'a', caption: t('myLang'), title: t('nsMine'), value: a, codes: SX_CODES }, { k: 'b', caption: t('otherLang'), title: t('nsOther'), value: b, codes: SX_CODES }]);
  const pickLang = (k, v) => {
    if (k === 'src') setSrc(v);
    if (k === 'target') setTarget(v);
    // 양방향은 두 언어가 같을 수 없다 — 같은 걸 고르면 서로 바꾼다
    if (k === 'a') { if (v === b) setB(a); setA(v); }
    if (k === 'b') { if (v === a) setA(b); setB(v); }
  };
  // 다시 열 때 이 세션의 언어를 복원하도록 기억
  const remember = (id, mode) => {
    try {
      if (mode === 'oneway') {
        localStorage.setItem('kac-sx-target', target);
        localStorage.setItem('kac-sx-target:' + id, target);
      } else {
        localStorage.setItem('kac-sx-a', a);
        localStorage.setItem('kac-sx-b', b);
        localStorage.setItem('kac-sx-pair:' + id, `${a}|${b}`);
      }
    } catch {}
  };
  return { src, target, boxes, pickLang, remember };
}
