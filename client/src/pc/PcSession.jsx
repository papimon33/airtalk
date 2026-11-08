/* PC 세션 화면(실시간 번역·양방향 통역)의 위 띠와 아래 조작 바 — 폰과 같은 기능·버튼 모양을 웹 방식으로(2026-11-07).
   · 위: 뒤로 · 세션 이름 · 모드(번역 전에만 바꿈) · 번역 중 표시와 경과 시간 · 뷰어 수 · 링크 공유
   · 아래: 디스코드 통화 바처럼 묶음 — [마이크 ⌄] [번역 음성 ⌄] [언어 → 언어] [⋯] [시작/중지]
     ⌄ 는 그 버튼 바로 위에 작은 메뉴를 띄운다(디스코드 음성 메뉴처럼). 고르는 줄은 옆으로 목록이 펼쳐진다.
     언어는 늘 보인다(누르면 검색되는 목록).
   상태·동작은 MobileLive(=TranslateView 값)가 갖고, 여기서는 그리기만 한다. */
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import { alpha } from '@mui/material/styles';
import Slider from '@mui/material/Slider';
import { SensSlider, langOptions, stereoMsg } from '../phone/common.jsx';
import { setPref } from '../shared/prefs.js';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronRightIcon, MicIcon, MicOffIcon, PlayIcon, QrIcon, SwapIcon, TtsIcon } from '../shared/icons.jsx';
import { BRAND, BRAND_SOFT } from '../shared/brand.js';

const BAR_BG = (th) => (th.palette.mode === 'dark' ? '#2B2D31' : '#F1F1F4');
const HOVER = (th) => alpha(th.palette.text.primary, 0.07);
const SOFT = (th) => (th.palette.mode === 'dark' ? alpha(BRAND, 0.28) : BRAND_SOFT);
const MENU_PAPER = { borderRadius: '12px', border: 0, backgroundImage: 'none', boxShadow: '0 12px 32px rgba(0,0,0,0.18)', py: 0.75 };
const Chevron = ({ open, size = 15 }) => <ChevronRightIcon sx={{ fontSize: size, transform: `rotate(${open ? -90 : 90}deg)`, transition: 'transform 120ms' }} />;

// 아래 바의 묶음(디스코드처럼 회색 둥근 상자 하나에 버튼 여럿)
function Group({ children }) {
  return <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, p: 0.5, borderRadius: '14px', bgcolor: BAR_BG, boxShadow: '0 4px 14px rgba(0,0,0,0.07)' }}>{children}</Box>;
}

// 아이콘 버튼 + 세부 설정 ⌄
function Split({ label, menuLabel, icon, onClick, onMenu, menuOpen, tone, disabled }) {
  const color = tone === 'danger' ? 'error.main' : tone === 'off' ? 'text.secondary' : 'text.primary';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', borderRadius: '10px', bgcolor: tone === 'danger' ? (th) => alpha(th.palette.error.main, 0.12) : 'transparent' }}>
      <Tooltip title={label}>
        <span>
          <ButtonBase onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={tone === 'on' || tone === 'danger'}
            sx={{ width: 40, height: 40, borderRadius: '10px', color, opacity: disabled ? 0.4 : 1, '&:hover': { bgcolor: HOVER }, '& svg': { fontSize: 20 } }}>
            {icon}
          </ButtonBase>
        </span>
      </Tooltip>
      <ButtonBase onClick={onMenu} aria-label={menuLabel} aria-haspopup="true" aria-expanded={menuOpen}
        sx={{ width: 22, height: 40, borderRadius: '8px', color: 'text.secondary', bgcolor: menuOpen ? HOVER : 'transparent', '&:hover': { bgcolor: HOVER } }}>
        <Chevron open={menuOpen} size={14} />
      </ButtonBase>
    </Box>
  );
}

// 언어 칸 — 작은 이름(입력 언어 등) + 고른 언어 + ⌄
function LangChip({ caption, value, onClick, open, locked }) {
  return (
    <ButtonBase onClick={onClick} aria-label={`${caption}: ${value}`} aria-haspopup="true" aria-expanded={open}
      sx={{ height: 40, px: 1.25, minWidth: 100, maxWidth: 180, borderRadius: '10px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', bgcolor: open ? SOFT : 'transparent', '&:hover': { bgcolor: open ? SOFT : HOVER } }}>
      <Typography component="span" sx={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1.25, color: 'text.secondary' }}>{caption}</Typography>
      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: '100%', color: locked ? 'text.secondary' : 'text.primary' }}>
        <Typography component="span" noWrap sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.3 }}>{value}</Typography>
        <Chevron open={open} size={13} />
      </Box>
    </ButtonBase>
  );
}

// 버튼 바로 위에 뜨는 작은 메뉴
function Pop({ anchor, onClose, width = 300, label, children }) {
  // 옆 목록이 열려 있으면 그쪽이 맨 위 창이라 MUI 가 Esc 를 이 메뉴에 넘기지 않는다 — 직접 받아 닫는다
  return (
    <Popover open={!!anchor} anchorEl={anchor} onClose={onClose} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }} transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      slotProps={{ paper: { 'aria-label': label, sx: { ...MENU_PAPER, mt: -1, width, maxWidth: 'calc(100vw - 24px)' } } }}>
      {children}
    </Popover>
  );
}
// 메뉴 줄 — 제목 + 지금 값(작은 회색) + 옆으로 펼치는 › (디스코드 '녹음 장치')
function Row({ label, value, sub, onOpen, onClick, onHover, icon, disabled }) {
  return (
    <ButtonBase onClick={onClick || onOpen} onMouseEnter={onHover} disabled={disabled} aria-haspopup={sub ? 'true' : undefined}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, mx: 0.75, width: 'calc(100% - 12px)', px: 1, py: 0.75, minHeight: 34, borderRadius: '8px', textAlign: 'left', opacity: disabled ? 0.45 : 1, '&:hover': { bgcolor: HOVER } }}>
      {icon}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{label}</Typography>
        {value && <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.35 }}>{value}</Typography>}
      </Box>
      {sub && <ChevronRightIcon sx={{ fontSize: 15, color: 'text.secondary' }} />}
    </ButtonBase>
  );
}
// 옆으로 펼쳐지는 목록(마우스를 올리거나 누르면). 바깥을 누르면 바깥 메뉴와 함께 닫힌다.
// onClose = Esc — 옆 목록이 맨 위 창이라 Esc 를 여기서 받는다. 바깥 메뉴까지 함께 닫는다.
function SubPop({ anchor, label, onClose, children }) {
  return (
    <Popover open={!!anchor} anchorEl={anchor} onClose={onClose} hideBackdrop disableAutoFocus disableEnforceFocus disableRestoreFocus disableScrollLock
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      sx={{ pointerEvents: 'none' }}
      slotProps={{ paper: { 'aria-label': label, sx: { ...MENU_PAPER, pointerEvents: 'auto', ml: 1, mt: -0.75, minWidth: 220, maxWidth: 340, maxHeight: 320, overflowY: 'auto' } } }}>
      <Box role="radiogroup" aria-label={label}>{children}</Box>
    </Popover>
  );
}
// 고르는 줄(오른쪽 동그라미 = 선택됨)
function Radio({ label, sub, on, onClick, disabled, extra }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', mx: 0.75, borderRadius: '8px', '&:hover': { bgcolor: disabled ? 'transparent' : HOVER } }}>
      <ButtonBase onClick={onClick} disabled={disabled} role="radio" aria-checked={!!on}
        sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1.25, px: 1, py: 0.75, minHeight: 34, borderRadius: '8px', textAlign: 'left', opacity: disabled ? 0.45 : 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 13.5, fontWeight: on ? 700 : 500 }}>{label}</Typography>
          {sub && <Typography noWrap sx={{ fontSize: 11.5, color: 'text.secondary' }}>{sub}</Typography>}
        </Box>
        <Box aria-hidden="true" sx={{ width: 16, height: 16, flex: 'none', borderRadius: '999px', border: 2, borderColor: on ? BRAND : 'text.disabled', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {on && <Box sx={{ width: 6, height: 6, borderRadius: '999px', bgcolor: BRAND }} />}
        </Box>
      </ButtonBase>
      {extra}
    </Box>
  );
}
// 켜고 끄는 줄(오른쪽 네모 체크 — 디스코드 '헤드셋 음소거')
function CheckRow({ label, checked, onChange }) {
  return (
    <ButtonBase onClick={() => onChange(!checked)} role="checkbox" aria-checked={!!checked}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, mx: 0.75, width: 'calc(100% - 12px)', px: 1, py: 0.75, minHeight: 34, borderRadius: '8px', textAlign: 'left', '&:hover': { bgcolor: HOVER } }}>
      <Typography sx={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{label}</Typography>
      <Box aria-hidden="true" sx={{ width: 18, height: 18, borderRadius: '5px', border: 2, borderColor: checked ? BRAND : 'text.disabled', bgcolor: checked ? BRAND : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {checked && <CheckIcon sx={{ fontSize: 13, strokeWidth: 3 }} />}
      </Box>
    </ButtonBase>
  );
}
const Line = () => <Divider sx={{ my: 0.75, mx: 1.5 }} />;
// 줄 오른쪽 두 칸 고르기(TTS 재생 꺼짐|켜짐)
function SegRow({ label, value, options, onChange, disabled }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mx: 0.75, px: 1, py: 0.5, minHeight: 38, opacity: disabled ? 0.45 : 1 }}>
      <Typography sx={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{label}</Typography>
      <Box role="radiogroup" aria-label={label} sx={{ display: 'inline-flex', p: 0.4, gap: 0.4, borderRadius: '9px', bgcolor: (th) => alpha(th.palette.text.primary, 0.07) }}>
        {options.map((o) => {
          const on = o.code === value;
          return (
            <ButtonBase key={String(o.code)} role="radio" aria-checked={on} disabled={disabled} onClick={() => { if (!on) onChange(o.code); }}
              sx={{ height: 26, px: 1.25, borderRadius: '7px', fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? (o.code ? '#fff' : 'text.primary') : 'text.secondary', bgcolor: on ? (o.code ? BRAND : 'background.paper') : 'transparent', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.12)' : 'none' }}>
              {o.label}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}
// 이름 + 막대(음량·텍스트 크기)
function SlideRow({ label, value, min, max, step, fmt, onChange, disabled }) {
  return (
    <Box sx={{ mx: 0.75, px: 1, pt: 0.5, pb: 0.25, opacity: disabled ? 0.45 : 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{label}</Typography>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</Typography>
      </Box>
      <Slider size="small" value={value} min={min} max={max} step={step} disabled={disabled} aria-label={label} onChange={(e, v) => onChange(v)}
        sx={{ color: BRAND, py: 1.25, '& .MuiSlider-thumb': { width: 14, height: 14 } }} />
    </Box>
  );
}

// 언어 고르기 — 위에 검색, 아래 목록(60개 언어)
function LangPop({ anchor, onClose, title, value, codes, onPick, t }) {
  const [q, setQ] = useState('');
  useEffect(() => { if (anchor) setQ(''); }, [anchor]);
  const opts = langOptions(codes || [], t);
  const k = q.trim().toLowerCase();
  const shown = k ? opts.filter((o) => (o.label + ' ' + o.sub + ' ' + o.code).toLowerCase().includes(k)) : opts;
  return (
    <Pop anchor={anchor} onClose={onClose} width={260} label={title}>
      <Box sx={{ px: 1, pb: 0.75 }}>
        <InputBase autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchLang')} inputProps={{ 'aria-label': t('searchLang') }}
          onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { onPick(shown[0].code); onClose(); } }}
          sx={{ width: '100%', height: 34, px: 1.25, borderRadius: '8px', fontSize: 13.5, bgcolor: (th) => alpha(th.palette.text.primary, 0.06) }} />
      </Box>
      <Box role="radiogroup" aria-label={title} sx={{ maxHeight: 320, overflowY: 'auto' }}>
        {shown.map((o) => <Radio key={o.code} label={o.label} sub={o.sub} on={o.code === value} onClick={() => { onPick(o.code); onClose(); }} />)}
        {!shown.length && <Typography sx={{ px: 2, py: 1.5, fontSize: 13, color: 'text.secondary' }}>{t('noLangMatch')}</Typography>}
      </Box>
    </Pop>
  );
}

// 번역 중 표시 + 경과 시간
function LiveBadge({ since, reconn, label }) {
  const [, setTick] = useState(0);
  useEffect(() => { const h = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(h); }, []);
  const s = since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0;
  const mm = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.1, height: 26, borderRadius: '999px', flex: 'none', bgcolor: (th) => alpha(reconn ? th.palette.warning.main : th.palette.error.main, 0.12), color: reconn ? 'warning.dark' : 'error.main' }}>
      <Box sx={{ width: 7, height: 7, borderRadius: '999px', bgcolor: 'currentColor' }} />
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{label}{since ? ` ${mm}:${ss}` : ''}</Typography>
    </Box>
  );
}

export function PcHeader({ t, p, onLeave, onShare, toast }) {
  const pc = p.pc || {};
  const [modeAnchor, setModeAnchor] = useState(null);
  const modeName = (v) => (v === 'twoway' ? t('modeTwoway') : t('modeOneway'));
  return (
    <Box sx={{ position: 'absolute', left: 0, right: 0, top: 0, zIndex: 2, height: 56, display: 'flex', alignItems: 'center', gap: 1, px: 1.75, bgcolor: 'background.default' }}>
      <Tooltip title={t('back')}>
        <ButtonBase onClick={onLeave} aria-label={t('back')} sx={{ width: 36, height: 36, borderRadius: '10px', flex: 'none', '&:hover': { bgcolor: HOVER } }}><ArrowLeftIcon sx={{ fontSize: 20 }} /></ButtonBase>
      </Tooltip>
      <Typography component="h1" noWrap sx={{ fontSize: 16, fontWeight: 800, minWidth: 0, flexShrink: 1 }}>{p.title}</Typography>
      {pc.mode && (
        <ButtonBase onClick={(e) => { if (p.recording) toast(t('lockedWhileRec')); else setModeAnchor(e.currentTarget); }} aria-label={`${t('pcMode')}: ${modeName(pc.mode)}`} aria-haspopup="true"
          sx={{ flex: 'none', height: 26, px: 1.1, gap: 0.4, borderRadius: '999px', fontSize: 12.5, fontWeight: 700, color: 'text.secondary', bgcolor: (th) => alpha(th.palette.text.primary, 0.06), '&:hover': { bgcolor: HOVER } }}>
          {modeName(pc.mode)}{!p.recording && <Chevron open={!!modeAnchor} size={13} />}
        </ButtonBase>
      )}
      {p.recording && <LiveBadge since={p.recStartAt} reconn={p.connState === 'reconn'} label={p.twoway ? t('interpreting') : t('translating')} />}
      <Box sx={{ flex: 1 }} />
      {p.viewerCount > 0 && <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'text.secondary', flex: 'none' }}>{t('viewersN', { n: p.viewerCount })}</Typography>}
      <ButtonBase onClick={onShare} sx={{ flex: 'none', height: 34, px: 1.5, gap: 0.75, borderRadius: '10px', fontSize: 13, fontWeight: 700, bgcolor: SOFT, color: BRAND }}>
        <QrIcon sx={{ fontSize: 17 }} />{t('shareLink')}
      </ButtonBase>
      <Menu anchorEl={modeAnchor} open={!!modeAnchor} onClose={() => setModeAnchor(null)} slotProps={{ paper: { sx: { ...MENU_PAPER, mt: 0.5 } } }}>
        {['oneway', 'twoway'].map((v) => (
          <MenuItem key={v} selected={pc.mode === v} onClick={() => { setModeAnchor(null); pc.onMode(v); }} sx={{ display: 'block', py: 0.75, mx: 0.75, borderRadius: '8px', maxWidth: 300, whiteSpace: 'normal' }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{modeName(v)}</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{v === 'twoway' ? t('modeTwowayDesc') : t('modeOnewayDesc')}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

/* c = MobileLive 의 상태·동작 묶음 */
export function PcDock({ t, p, c }) {
  const pc = p.pc || {};
  const [pop, setPop] = useState(null); // { k: 'mic'|'tts'|'lang0'|'lang1'|'more', el }
  const [sub, setSub] = useState(null); // 옆으로 펼친 목록 { k, el }
  const open = (k) => (e) => { setSub(null); setPop((o) => (o && o.k === k ? null : { k, el: e.currentTarget })); };
  const at = (k) => (pop && pop.k === k ? pop.el : null);
  const close = () => { setSub(null); setPop(null); if (c.micTest) c.setMicTest(false); };
  const subAt = (k) => (sub && sub.k === k ? sub.el : null);
  const hover = (k) => (e) => setSub(k ? { k, el: e.currentTarget } : null);
  const srcName = (v) => ({ mic: t('srcMic'), system: t('srcSystem'), both: t('srcBoth') }[v] || v);
  const langs = p.twoway
    ? [
      { caption: t('myLang'), value: p.sxA, codes: p.sxCodes, onPick: p.onA },
      { caption: t('otherLang'), value: p.sxB, codes: p.sxCodes, onPick: p.onB },
    ]
    : [
      { caption: t('inputLang'), value: p.inLang, codes: p.inCodes, onPick: p.onInLang },
      { caption: t('outputLang'), value: p.sxTarget, codes: p.sxCodes, onPick: p.onTarget },
    ];
  const langName = (v) => (v === 'auto' ? t('autoDetect') : t.lang(v));
  const pickLang = (i) => (e) => { if (p.recording) { c.toast(t('langLocked')); return; } open('lang' + i)(e); };
  const usesMic = pc.sourceMode !== 'system';
  // 장치 id 가 비어 있으면(마이크 권한 전) 고를 수 없다 — '기본 마이크'만
  const devs = [{ deviceId: '', label: t('defaultMic') }, ...(pc.micDevs || []).filter((d) => d.deviceId && d.deviceId !== 'default')];
  const curDev = devs.find((d) => d.deviceId && d.deviceId === pc.micId) || devs[0];
  const pick = (fn) => { if (p.recording) { c.toast(t('lockedWhileRec')); return; } fn(); setSub(null); };
  return (
    <Box sx={{ position: 'absolute', zIndex: 2, left: 0, right: 0, bottom: 16, display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: 1, px: 2, pointerEvents: 'none', '& > *': { pointerEvents: 'auto' } }}>
      <Group>
        <Split label={c.muteOn ? t('unmute') : t('mute')} menuLabel={t('micOptions')} icon={c.muteOn ? <MicOffIcon /> : <MicIcon />}
          tone={c.muteOn ? 'danger' : p.recording ? undefined : 'off'} onClick={c.toggleMute} onMenu={open('mic')} menuOpen={!!at('mic')} />
        {p.ttsPerm && (
          <Split label={c.ttsMade ? t('tts') : t('ttsOff')} menuLabel={t('ttsOptions')} icon={<TtsIcon off={!c.ttsMade} />} disabled={!p.ttsAllowed}
            tone={c.ttsMade ? 'on' : 'off'} onClick={c.toggleTts} onMenu={open('tts')} menuOpen={!!at('tts')} />
        )}
      </Group>

      {/* 언어 — 늘 보인다. 번역 중에는 바꿀 수 없다 */}
      <Group>
        <LangChip caption={langs[0].caption} value={langName(langs[0].value)} onClick={pickLang(0)} open={!!at('lang0')} locked={p.recording} />
        {p.twoway ? (
          <Tooltip title={t('swapLangs')}>
            <span>
              <ButtonBase onClick={() => { if (p.recording) { c.toast(t('langLocked')); return; } p.onA(p.sxB); }} aria-label={t('swapLangs')}
                sx={{ width: 28, height: 40, borderRadius: '8px', color: 'text.secondary', '&:hover': { bgcolor: HOVER } }}><SwapIcon sx={{ fontSize: 16 }} /></ButtonBase>
            </span>
          </Tooltip>
        ) : <ArrowRightIcon aria-hidden="true" sx={{ fontSize: 16, color: 'text.secondary', mx: 0.25 }} />}
        <LangChip caption={langs[1].caption} value={langName(langs[1].value)} onClick={pickLang(1)} open={!!at('lang1')} locked={p.recording} />
      </Group>

      <Group>
        <Tooltip title={t('more')}>
          <ButtonBase onClick={open('more')} aria-label={t('more')} aria-haspopup="true" aria-expanded={!!at('more')}
            sx={{ width: 40, height: 40, borderRadius: '10px', fontSize: 18, fontWeight: 900, letterSpacing: '0.08em', bgcolor: at('more') ? HOVER : 'transparent', '&:hover': { bgcolor: HOVER } }}>⋯</ButtonBase>
        </Tooltip>
      </Group>

      <ButtonBase onClick={p.recording ? p.onStop : c.start} disabled={c.starting}
        sx={{ height: 48, px: 2.25, gap: 0.9, borderRadius: '14px', fontSize: 14.5, fontWeight: 800, color: '#fff', bgcolor: p.recording ? 'error.main' : BRAND, boxShadow: p.recording ? '0 6px 16px rgba(220,38,38,0.26)' : '0 6px 16px rgba(91,79,232,0.30)' }}>
        {c.starting ? <CircularProgress size={16} sx={{ color: '#fff' }} />
          : p.recording ? <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: '#fff' }} /> : <PlayIcon sx={{ fontSize: 17 }} />}
        {p.recording ? t('stop') : t('start')}
      </ButtonBase>

      {/* 마이크 ⌄ — 입력 소스·입력 장치(옆 목록) · 입력 감도 · 입력 테스트. 시스템 오디오만 들을 땐 마이크 항목을 흐리게(숨기지 않음) */}
      <Pop anchor={at('mic')} onClose={close} width={300} label={t('micOptions')}>
        {(pc.srcOpts || []).length > 1 && (
          <Row label={t('pcSource')} value={srcName(pc.sourceMode)} sub onOpen={hover('src')} onHover={hover('src')} />
        )}
        <Row label={t('pcMicDevice')} value={curDev.label || t('defaultMic')} sub={usesMic} disabled={!usesMic} onOpen={hover('dev')} onHover={hover(usesMic ? 'dev' : null)} />
        <Box onMouseEnter={hover(null)} aria-disabled={!usesMic} sx={usesMic ? undefined : { opacity: 0.45, pointerEvents: 'none' }}>
          <Line />
          {c.dual && <SensSlider compact label={t('tx1')} value={p.micSens} native={p.micNative} level={c.liveLevel} onChange={p.onMicSens} />}
          {c.dual && <SensSlider compact label={t('tx2')} value={p.micSens2} native={p.micNative} level={c.liveLevel2} onChange={p.onMicSens2} />}
          {!c.dual && <SensSlider compact label={t('inputSens')} value={p.micSens} native={p.micNative} level={c.liveLevel} onChange={p.onMicSens} />}
          {c.twoCh && <Typography sx={{ fontSize: 12, color: 'text.secondary', px: 1.75, pb: 0.75, lineHeight: 1.5, wordBreak: 'keep-all' }}>{stereoMsg(c.chanState, t)}</Typography>}
          {/* 번역 전에 고른 장치로 입력 크기를 본다 — 위 감도 막대에 지금 소리가 진한 선으로 나온다 */}
          {!p.recording && (
            <>
              <Row label={c.micTest ? t('micTestStop') : t('micTest')} value={c.micTest ? t('micTestHint') : ''}
                icon={c.micTest ? <Box sx={{ width: 8, height: 8, mx: 0.5, borderRadius: '999px', bgcolor: 'error.main', animation: 'pcPulse 1.2s infinite', '@keyframes pcPulse': { '50%': { opacity: 0.3 } } }} /> : <MicIcon sx={{ fontSize: 17, color: 'text.secondary' }} />}
                onClick={() => c.setMicTest(!c.micTest)} />
            </>
          )}
        </Box>
        <SubPop anchor={subAt('src')} label={t('pcSource')} onClose={close}>
          {(pc.srcOpts || []).map((v) => <Radio key={v} label={srcName(v)} on={pc.sourceMode === v} onClick={() => pick(() => pc.onSource(v))} disabled={p.recording && pc.sourceMode !== v} />)}
        </SubPop>
        <SubPop anchor={subAt('dev')} label={t('pcMicDevice')} onClose={close}>
          {devs.map((d, i) => (
            <Radio key={d.deviceId || 'default'} label={d.label || `${t('srcMic')} ${i}`} on={d === curDev}
              onClick={() => pick(() => pc.onMicId(d.deviceId))} disabled={p.recording && d !== curDev} />
          ))}
        </SubPop>
      </Pop>

      {/* 번역 음성 ⌄ — TTS 재생(아이콘과 같은 값) · TTS 음성(옆 목록, 미리듣기) · 음량(0 = 이 기기에서 재생 안 함, 이 기기용 합성도 안 함) · 뷰어에서 재생 지원 */}
      <Pop anchor={at('tts')} onClose={close} width={290} label={t('ttsOptions')}>
        <Box onMouseEnter={hover(null)}>
          <SegRow label={t('ttsPlay')} value={!!c.ttsMade} disabled={!p.ttsAllowed} onChange={() => c.toggleTts()}
            options={[{ code: false, label: t('off') }, { code: true, label: t('on') }]} />
        </Box>
        <Row label={t('ttsVoice')} value={c.voiceName(p.gender)} sub={c.ttsMade} disabled={!c.ttsMade} onOpen={hover('voice')} onHover={hover(c.ttsMade ? 'voice' : null)} />
        <Box onMouseEnter={hover(null)}>
          <SlideRow label={t('volume')} value={c.hereOn ? Math.round((p.volume ?? 1) * 100) : 0} min={0} max={100} step={5} fmt={(v) => `${v}%`} disabled={!c.ttsMade}
            onChange={(v) => {
              if (v === 0) { if (c.hereOn) p.onViewerOnly(true); return; } // 0 = 이 기기에서는 재생하지 않음(서버도 이 기기용으로 만들지 않는다)
              if (!c.hereOn) p.onViewerOnly(false);
              p.onVolume(v / 100);
            }} />
          <CheckRow label={t('viewerTts')} checked={p.viewerTts !== false} onChange={(v) => p.onViewerTts(v)} />
        </Box>
        <SubPop anchor={subAt('voice')} label={t('ttsVoice')} onClose={close}>
          {['f', 'm'].map((g) => (
            <Radio key={g} label={c.voiceName(g)} on={p.gender === g} onClick={() => p.onGender(g)}
              extra={(
                <Tooltip title={t('previewVoice', { v: c.voiceName(g) })}>
                  <ButtonBase onClick={() => c.preview(g)} aria-label={t('previewVoice', { v: c.voiceName(g) })}
                    sx={{ width: 28, height: 28, mr: 0.5, borderRadius: '8px', flex: 'none', bgcolor: SOFT, color: BRAND }}>
                    {c.previewing === g ? <CircularProgress size={13} sx={{ color: 'inherit' }} /> : <PlayIcon sx={{ fontSize: 13 }} />}
                  </ButtonBase>
                </Tooltip>
              )} />
          ))}
        </SubPop>
      </Pop>

      {langs.map((l, i) => (
        <LangPop key={i} anchor={at('lang' + i)} onClose={close} title={l.caption} value={l.value} codes={l.codes} onPick={l.onPick} t={t} />
      ))}

      {/* ⋯ 더 보기 */}
      <Menu anchorEl={at('more')} open={!!at('more')} onClose={close}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }} transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ paper: { sx: { ...MENU_PAPER, mt: -1, minWidth: 200, '& .MuiMenuItem-root': { fontSize: 13.5, fontWeight: 600, minHeight: 34, mx: 0.75, borderRadius: '8px' } } } }}>
        <MenuItem disabled={!p.canSave} onClick={() => { close(); p.onSaveTranscript(); }}>{t('saveTranscript')}</MenuItem>
        <MenuItem onClick={() => { close(); c.setSheet('rename'); }}>{t('rename')}</MenuItem>
        {pc.isElectron && <MenuItem onClick={() => { close(); pc.onOverlay(); }}>{t('overlayWin')}</MenuItem>}
        <Divider sx={{ my: '6px !important', mx: 1.5 }} />
        {/* 텍스트 크기 — 바로 막대로(설정 > 화면과 같은 값) */}
        <Box onKeyDown={(e) => e.stopPropagation()}>
          <SlideRow label={t('textSize')} value={p.fontScale || 1} min={0.8} max={1.6} step={0.1} fmt={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setPref('fontScale', Math.round(v * 10) / 10)} />
        </Box>
        <Divider sx={{ my: '6px !important', mx: 1.5 }} />
        <MenuItem disabled={!p.canSave} onClick={() => { close(); c.setSheet('clear'); }}>{t('clearHistory')}</MenuItem>
      </Menu>
    </Box>
  );
}
