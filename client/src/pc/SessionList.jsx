import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import ButtonBase from '@mui/material/ButtonBase';
import InputBase from '@mui/material/InputBase';
import InputAdornment from '@mui/material/InputAdornment';
import Avatar from '@mui/material/Avatar';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import Skeleton from '@mui/material/Skeleton';
import { alpha } from '@mui/material/styles';
import Snackbar from '@mui/material/Snackbar';
import { ModeIcon, shortDate, sessionLangs } from '../shared/sessionMeta.jsx';
import { langName } from '../shared/i18n.js';
import MuiAlert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import ConfirmDialog from '../shared/ConfirmDialog.jsx';
import { api } from '../shared/api.js';
import { RADIUS } from '../shared/theme.js';
import { IcoHeadset } from './icons.jsx';
import { can } from '../shared/authState.js';
import { useT } from '../shared/i18n.js';
import { BRAND, BRAND_SOFT } from '../shared/brand.js';
import { useSessionLangs, defaultName } from '../shared/newSession.js';
import { PickSheet, FormSheet, langOptions } from '../phone/common.jsx';
import { PlusIcon, ArrowRightIcon, SwapIcon, HeadsetIcon } from '../shared/icons.jsx';

function rel(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

// 모드 아이콘(첨부 SVG → currentColor. 배경색에 맞춰 색 상속). 1=스피커, 2=화면, 3=양방향.
export function IconMode1(props) {
  return (
    <Box component="svg" viewBox="-0.5 0 25 25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12.5493 4.50005C11.3193 4.04005 8.70926 5.49996 6.54926 7.40996H4.94922C3.88835 7.40996 2.87093 7.83145 2.12079 8.58159C1.37064 9.33174 0.949219 10.3491 0.949219 11.41V13.41C0.949219 14.4708 1.37064 15.4883 2.12079 16.2385C2.87093 16.9886 3.88835 17.41 4.94922 17.41H6.54926C8.65926 19.35 11.2693 20.78 12.5493 20.33C14.6493 19.55 14.9992 15.33 14.9992 12.41C14.9992 9.48996 14.6493 5.28005 12.5493 4.50005Z" />
      <path d="M20.6602 6.71997C22.1593 8.22011 23.0015 10.2542 23.0015 12.375C23.0015 14.4958 22.1593 16.5299 20.6602 18.03" />
      <path d="M18.5391 15.95C19.4764 15.0123 20.003 13.7407 20.003 12.4149C20.003 11.0891 19.4764 9.81764 18.5391 8.88" />
    </Box>
  );
}
export function IconMode2(props) {
  return (
    <Box component="svg" viewBox="0 0 32 32" fill="currentColor" {...props}>
      <path d="M23,28L23,28c-1.1,0-2.1-0.7-2.5-1.8c0-0.1,0-0.2-0.1-0.2h-8.9c0,0.1,0,0.2-0.1,0.2C11.1,27.3,10.1,28,9,28h0 c-0.6,0-1,0.4-1,1s0.4,1,1,1h14c0.6,0,1-0.4,1-1S23.6,28,23,28z" />
      <path d="M15.6,10.2c-0.3-0.2-0.7-0.3-1.1-0.1C14.2,10.3,14,10.6,14,11v5c0,0.4,0.2,0.7,0.6,0.9C14.7,17,14.9,17,15,17 c0.2,0,0.5-0.1,0.6-0.2l3-2.5c0.2-0.2,0.4-0.5,0.4-0.8s-0.1-0.6-0.4-0.8L15.6,10.2z" />
      <path d="M27,3H5C3.3,3,2,4.3,2,6v15c0,1.7,1.3,3,3,3h6.9h8.1H27c1.7,0,3-1.3,3-3V6C30,4.3,28.7,3,27,3z M26,19c0,0.6-0.4,1-1,1H7 c-0.6,0-1-0.4-1-1V8c0-0.6,0.4-1,1-1h18c0.6,0,1,0.4,1,1V19z" />
    </Box>
  );
}
export function IconMode3(props) {
  return (
    <Box component="svg" viewBox="0 0 45.363 45.363" fill="currentColor" {...props}>
      <path d="M1.788,16.945c0.388,0.385,0.913,0.601,1.459,0.601l27.493-0.035v3.831c0.003,0.836,0.556,1.586,1.329,1.904 c0.771,0.314,1.658,0.135,2.246-0.459l9.091-9.18c1.062-1.071,1.06-2.801-0.009-3.868l-9.137-9.134 c-0.59-0.591-1.479-0.768-2.25-0.446c-0.77,0.319-1.271,1.074-1.27,1.908L30.74,5.9L3.219,5.937 C2.08,5.94,1.161,6.864,1.163,8.004l0.018,7.483C1.182,16.034,1.401,16.56,1.788,16.945z" />
      <path d="M42.146,27.901l-27.522-0.035l-0.001-3.834c0.002-0.835-0.5-1.587-1.27-1.907c-0.771-0.321-1.66-0.146-2.25,0.445 l-9.136,9.135c-1.067,1.064-1.071,2.796-0.009,3.866l9.09,9.181c0.588,0.596,1.475,0.772,2.247,0.458 c0.772-0.316,1.326-1.066,1.329-1.904v-3.83l27.493,0.035c0.547,0,1.072-0.216,1.459-0.602s0.605-0.91,0.607-1.456L44.2,29.97 C44.203,28.83,43.284,27.903,42.146,27.901z" />
    </Box>
  );
}
// 새 세션 모달 — 모드 2종(번역 방향) + 관리자에게만 안내데스크(별도 항목). 음성 입력(마이크/시스템)은 세션 안에서 고른다.
// 세션 모드 표시명(라이브 헤더·목록 배지). 구 프리셋(live/online/mobile/field/meeting)은 서버가 부팅 시
// 이 둘로 이전하지만, 이전 전 응답·캐시 대비로 같은 이름에 매핑해 둔다.
export const TYPE_NAME = { oneway: '실시간 번역', twoway: '양방향 통역', live: '실시간 번역', online: '실시간 번역', mobile: '양방향 통역', field: '양방향 통역', meeting: '양방향 통역' };
// 세션 모드 → 아이콘(목록·모달 공용)
export const MODE_ICON = { oneway: IconMode1, twoway: IconMode3, live: IconMode1, online: IconMode1, mobile: IconMode3, field: IconMode3, meeting: IconMode3 };

// 세션 목록 행 아이콘 — 유형 무관 단일 채팅 아이콘(요청: 목록 아이콘 통일)
export function IcoChat(props) {
  return (
    <Box component="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </Box>
  );
}
// 검색어 하이라이트: 대소문자 무시하고 매칭 부분만 강조(굵게+액센트)
function Highlight({ text, q }) {
  const s = String(text || '');
  if (!q) return s;
  const parts = [];
  const lower = s.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0, n = 0;
  while (n < 30) {
    const j = lower.indexOf(ql, i);
    if (j < 0) { parts.push(s.slice(i)); break; }
    if (j > i) parts.push(s.slice(i, j));
    parts.push(<Box component="span" key={j} sx={{ fontWeight: 800, color: 'text.primary' }}>{s.slice(j, j + q.length)}</Box>);
    i = j + q.length; n++;
  }
  return parts;
}

// 새 세션 모달의 항목 카드(아이콘 · 이름 · 배지 · 설명 · 선택 표시)
function OptionCard({ Icon: Ic, title, desc, sel, onClick }) {
  return (
    <ButtonBase role="radio" aria-checked={sel} onClick={onClick}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.75, width: '100%', textAlign: 'left', borderRadius: '20px', p: 1.75,
        border: 2, borderColor: sel ? BRAND : 'divider',
        bgcolor: (th) => (sel ? (th.palette.mode === 'dark' ? alpha(BRAND, 0.22) : BRAND_SOFT) : 'transparent'),
        transition: 'border-color .12s, background .12s',
        '&:hover': { borderColor: sel ? BRAND : 'text.disabled' },
      }}>
      <Box sx={{ width: 44, height: 44, borderRadius: '13px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (th) => alpha(BRAND, th.palette.mode === 'dark' ? 0.28 : 0.12), color: BRAND }}>
        <Ic sx={{ width: 23, height: 23 }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography component="span" sx={{ display: 'block', fontWeight: 800, fontSize: 16.5, color: sel ? BRAND : 'text.primary' }}>{title}</Typography>
        <Typography component="span" sx={{ display: 'block', fontSize: 13.5, color: 'text.secondary', lineHeight: 1.45, mt: 0.25, wordBreak: 'keep-all' }}>{desc}</Typography>
      </Box>
    </ButtonBase>
  );
}

// 중복되지 않는 기본 제목: "새 세션", "새 세션 1", "새 세션 2" ...
function uniqueName(base, titles) {
  if (!titles.includes(base)) return base;
  let i = 1;
  while (titles.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export default function SessionList({ onOpen, createSignal }) {
  const t = useT();
  const [langPick, setLangPick] = useState(null); // 새 세션 창에서 고르는 언어 칸
  const canDesk = can('desk'); // 목록은 내가 만든 세션만이라 이름 변경·삭제는 모든 줄에서 가능
  const [list, setList] = useState(null);
  const [q, setQ] = useState(''); // 검색어 — 제목+대화 내용(서버 검색)
  const [dlg, setDlg] = useState(false);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState('oneway'); // oneway=실시간 번역 / twoway=양방향 통역 / desk=안내데스크
  const langs = useSessionLangs(dlg);
  const [deskStat, setDeskStat] = useState({}); // 안내데스크 현황: id → { hostOn, active, lang, viewers }
  const [menu, setMenu] = useState(null);
  const [snack, setSnack] = useState(null);
  const [rename, setRename] = useState(null); // { id, val } 제목 변경
  const [selMode, setSelMode] = useState(false); // 일괄 선택 모드
  const [selIds, setSelIds] = useState(() => new Set());
  const [confirmReq, setConfirmReq] = useState(null); // 공용 확인 다이얼로그(브라우저 confirm 대체)

  const reload = () => api.list(q.trim()).then(setList).catch(() => {});
  // 안내데스크 현황: 목록에 안내데스크 세션이 있으면 상태(호스트 연결·응대 중·뷰어 수)를 10초 주기로
  const hasDesk = (list || []).some((s) => s.pipeline === 'desk');
  useEffect(() => {
    if (!hasDesk) return undefined;
    let dead = false;
    const tick = () => api.deskStatus().then((rows) => {
      if (dead || !Array.isArray(rows)) return;
      const m = {};
      rows.forEach((r) => { m[r.id] = r; });
      setDeskStat(m);
    }).catch(() => {});
    tick();
    const iv = setInterval(tick, 10000);
    return () => { dead = true; clearInterval(iv); };
  }, [hasDesk]);

  // 검색어 변경 시 디바운스 재조회(내용 검색은 서버에서)
  useEffect(() => {
    const t = setTimeout(() => { api.list(q.trim()).then(setList).catch(() => {}); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  // 명령 팔레트(⌘K)의 '새 세션 만들기' → 생성 모달 열기
  useEffect(() => { if (createSignal) openDlg(); }, [createSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseOf = (v) => (v === 'desk' ? '안내데스크' : '새 세션');
  const titles = () => (list || []).map((s) => s.title);
  const openDlg = () => {
    setName('');
    setPreset('oneway'); // 창을 열 때마다 기본 모드(실시간 번역)로
    setLangPick(null);
    setDlg(true);
  };
  const namePlaceholder = preset === 'desk' ? uniqueName(baseOf('desk'), titles()) : defaultName(preset, t);

  const [creating, setCreating] = useState(false); // 만들기 연타 → 세션 2개 생성 방지
  const create = async () => {
    if (creating) return;
    const title = name.trim() || namePlaceholder;
    const body = preset === 'desk'
      ? { title, pipeline: 'desk', inLang: 'auto' }
      : { title, pipeline: 'soniox', preset, src: 'mic', inLang: preset === 'oneway' ? langs.src : 'auto' };
    setCreating(true);
    try {
      const s = await api.create(body);
      if (preset !== 'desk') langs.remember(s.id, preset);
      setDlg(false);
      onOpen(preset === 'oneway' ? { ...s, _target: langs.target } : s);
    } catch (e) {
      setSnack({ ok: false, msg: '세션 생성 실패: ' + (e.message || '네트워크 오류') });
    } finally {
      setCreating(false);
    }
  };

  const exportSession = async (sess) => {
    let s;
    try { s = await api.get(sess.id); }
    catch (e) { setMenu(null); setSnack({ ok: false, msg: '내보내기 실패: ' + (e.message || '네트워크 오류') }); return; }
    setMenu(null);
    const lines = s.items.map((it) => {
      const who = it.side === 'left' ? '[시스템]' : '[마이크]';
      const txt = it.texts ? Object.values(it.texts).join(' / ') : it.text || '';
      return who + ' ' + txt + (it.source ? `  (${it.source})` : '');
    });
    const text = `${s.title}\n${new Date(s.createdAt).toLocaleString('ko-KR')}\n\n` + lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (s.title || 'session').replace(/[\\/:*?"<>|]/g, '_') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const removeSession = (sess) => {
    setMenu(null);
    setConfirmReq({
      title: '세션 삭제',
      message: `'${sess.title || '(제목 없음)'}' 세션을 삭제합니다. 목록에서 사라지며, 대화 기록은 관리자 로그에 보존됩니다.`,
      onOk: async () => {
        try { await api.remove(sess.id); } catch (e) { setSnack({ ok: false, msg: '삭제 실패: ' + (e.message || '네트워크 오류') }); }
        reload();
      },
    });
  };
  const startRename = (sess) => { setRename({ id: sess.id, val: sess.title || '' }); setMenu(null); };
  // 일괄 선택 삭제
  const toggleSel = (id) => setSelIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exitSel = () => { setSelMode(false); setSelIds(new Set()); };
  const bulkDelete = () => {
    const ids = [...selIds];
    if (!ids.length) return;
    setConfirmReq({
      title: '선택 세션 삭제',
      message: `선택한 ${ids.length}개 세션을 삭제합니다. 목록에서 사라지며, 대화 기록은 관리자 로그에 보존됩니다.`,
      onOk: async () => {
        const results = await Promise.allSettled(ids.map((id) => api.remove(id)));
        const fail = results.filter((r) => r.status === 'rejected').length;
        if (fail) setSnack({ ok: false, msg: `${fail}개 삭제 실패` });
        else setSnack({ ok: true, msg: `${ids.length}개 세션을 삭제했습니다.` });
        exitSel();
        reload();
      },
    });
  };
  const saveRename = async (id, val) => {
    try { await api.patch(id, { title: (val || '').trim() || '제목 없음' }); }
    catch (e) { setSnack({ ok: false, msg: '이름 변경 실패: ' + (e.message || '네트워크 오류') }); }
    reload();
  };
  const shown = list || [];
  const empty = list && shown.length === 0;

  return (
    <>
      <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, sm: 4 } }}>
        <Box sx={{ maxWidth: 860, mx: 'auto' }}>
          {/* 검색 + 상단 버튼(선택·새 세션) 한 줄 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, mb: { xs: 1.5, sm: 2.5 }, minHeight: 40 }}>
            {/* 검색 — 제목·대화 내용(서버 검색, Claude 스타일) */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {list && (shown.length > 0 || q.trim()) && !selMode && (
                <TextField
                  fullWidth
                  size="small"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="대화 검색 (제목·내용)"
                  InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon sx={{ fontSize: 20, color: 'text.disabled' }} /></InputAdornment>) }}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: RADIUS.panel, bgcolor: 'background.paper' } }}
                />
              )}
            </Box>
            {selMode && (
              <>
                <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: 'text.secondary', mr: 0.5 }}>{selIds.size}개 선택</Typography>
                <Button size="small" onClick={exitSel} sx={{ color: 'text.secondary' }}>취소</Button>
                <Button size="small" variant="contained" color="error" disabled={!selIds.size} onClick={bulkDelete} startIcon={<DeleteOutlineIcon />}>삭제</Button>
              </>
            )}
            {!selMode && shown.length > 0 && (
              <Button size="small" onClick={() => setSelMode(true)} sx={{ color: 'text.secondary', flex: 'none' }}>선택</Button>
            )}
            {!selMode && (
              <Button variant="contained" onClick={openDlg} startIcon={<PlusIcon strokeWidth={2.4} sx={{ fontSize: '18px !important' }} />}
                sx={{ flex: 'none', height: 40, px: 2, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: '#4A3FD4' } }}>
                {t('newSession')}
              </Button>
            )}
          </Box>

          {empty && q.trim() && (
            <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary' }}>‘{q.trim()}’ 검색 결과가 없습니다</Typography>
              <Typography sx={{ fontSize: 13, mt: 0.75 }}>제목과 대화 내용에서 찾습니다. 다른 검색어를 시도해 보세요.</Typography>
            </Box>
          )}
          {empty && !q.trim() && (
            <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
              <Avatar
                sx={{
                  width: 76, height: 76, mx: 'auto', mb: 2.5,
                  bgcolor: (t) => alpha(t.palette.text.primary, 0.06),
                  color: 'text.secondary',
                }}
              >
                <RecordVoiceOverIcon sx={{ fontSize: 38 }} />
              </Avatar>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary' }}>
                아직 세션이 없어요
              </Typography>
              <Typography sx={{ fontSize: 14, mt: 0.75, mb: 3 }}>
                새 세션을 만들고 외국어를 실시간으로 번역해 보세요.
              </Typography>
              <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openDlg}>
                새 세션 만들기
              </Button>
            </Box>
          )}

          {/* 로딩 중(첫 조회) — 빈 화면/빈 상태 오표시 대신 스켈레톤 행 */}
          {list === null && [0, 1, 2, 3].map((i) => (
            <Box key={'sk' + i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.75 }}>
              <Skeleton variant="text" sx={{ flex: 1, fontSize: 15 }} />
              <Skeleton variant="text" width={64} sx={{ display: { xs: 'none', sm: 'block' } }} />
              <Skeleton variant="text" width={48} />
            </Box>
          ))}

          {/* 목록 — Claude 채팅 목록 스타일: 모드 아이콘 · 제목 · 구분선 · 우측 시간(hover 시 케밥으로 전환) */}
          {shown.map((s, si) => {
            const checked = selIds.has(s.id);
            const desk = s.pipeline === 'desk';
            const v2Row = true; // 폰 목록과 같은 줄(모드 아이콘 + '날짜 · 언어')
            const searching = !!q.trim();
            return (
            <Box
              key={s.id}
              onClick={() => (selMode ? toggleSel(s.id) : onOpen(s))}
              sx={{
                display: 'flex', alignItems: searching && s.snippet ? 'flex-start' : 'center', gap: 1.5, px: 2, py: 1.9,
                borderRadius: 2, cursor: 'pointer', position: 'relative',
                bgcolor: selMode && checked ? (t) => alpha(t.palette.text.primary, 0.06) : 'transparent',
                '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.05) },
                '&:hover .rowKebab': { opacity: 1, pointerEvents: 'auto' },
                '&:hover .rowTime': { opacity: 0 },
                transition: 'background .12s',
              }}
            >
              {selMode && (
                <Checkbox checked={checked} onChange={() => toggleSel(s.id)} onClick={(e) => e.stopPropagation()} size="small" sx={{ p: 0.25, ml: -0.75 }} />
              )}
              {/* 유형 무관 단일 채팅 아이콘(스니펫 있을 땐 첫 줄에 정렬). PC 새 화면은 폰 목록과 같은 모드 아이콘 */}
              {v2Row && desk ? (
                <Box sx={{ width: 40, height: 40, flex: 'none', borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: (t) => alpha(t.palette.text.primary, 0.06) }}><IcoHeadset sx={{ width: 21, height: 21 }} /></Box>
              ) : v2Row ? <ModeIcon preset={s.preset} size={40} /> : (
                <IcoChat sx={{ width: 19, height: 19, flex: 'none', color: 'text.secondary', opacity: 0.85, mt: searching && s.snippet ? '2px' : 0, alignSelf: searching && s.snippet ? 'flex-start' : 'center' }} />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {searching ? <Highlight text={s.title || '(제목 없음)'} q={q.trim()} /> : (s.title || '(제목 없음)')}
                </Typography>
                {searching && s.snippet && (
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <Highlight text={s.snippet} q={q.trim()} />
                  </Typography>
                )}
                {v2Row && !(searching && s.snippet) && (
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[shortDate(s.updatedAt || s.createdAt, 'ko-KR'), desk ? '안내데스크' : sessionLangs(s, (c) => langName(c, 'ko'), { two: '양방향 통역', one: '실시간 번역' })].filter(Boolean).join(' · ')}
                  </Typography>
                )}
              </Box>
              {desk && (() => {
                const st = deskStat[s.id];
                if (!st) return null;
                const label = st.active ? `응대 중${st.lang ? ' · ' + st.lang.toUpperCase() : ''}` : st.hostOn ? '대기' : '오프라인';
                const color = st.active ? 'accent.main' : st.hostOn ? 'success.main' : 'text.disabled';
                return (
                  <Tooltip title={`호스트 ${st.hostOn ? '연결됨' : '없음'} · 뷰어 ${st.viewers}대`}>
                    <Box sx={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 0.6, fontSize: 12, color: 'text.secondary' }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
                      {label}{st.viewers > 0 ? ` · 뷰어 ${st.viewers}` : ''}
                    </Box>
                  </Tooltip>
                );
              })()}
              {!v2Row && (desk || (s.preset && TYPE_NAME[s.preset])) && (
                <Typography sx={{ flex: 'none', fontSize: 12.5, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
                  {desk ? '안내데스크' : TYPE_NAME[s.preset]}
                </Typography>
              )}
              {!v2Row && <Typography className="rowTime" sx={{ flex: 'none', fontSize: 13, color: 'text.secondary', minWidth: 52, textAlign: 'right', transition: 'opacity .12s', display: { xs: 'none', sm: 'block' }, alignSelf: searching && s.snippet ? 'flex-start' : 'center', mt: searching && s.snippet ? '2px' : 0 }}>{rel(s.updatedAt)}</Typography>}
              {!selMode && (
                <>
                  {/* 데스크톱: hover 시 케밥만(시간 자리로 스왑) — 액션은 케밥 메뉴로 통일 */}
                  <IconButton
                    className="rowKebab" size="small"
                    onClick={(e) => { e.stopPropagation(); setMenu({ anchor: e.currentTarget, session: s }); }}
                    sx={{
                      display: { xs: 'none', sm: 'inline-flex' }, position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      opacity: 0, pointerEvents: 'none', transition: 'opacity .12s', color: 'text.secondary',
                    }}
                  >
                    <MoreVertIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                  {/* 모바일: 케밥 상시 표시(hover 없음) */}
                  <IconButton size="small" sx={{ display: { xs: 'inline-flex', sm: 'none' }, flex: 'none' }} onClick={(e) => { e.stopPropagation(); setMenu({ anchor: e.currentTarget, session: s }); }}>
                    <MoreVertIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </>
              )}
            </Box>
            );
          })}
        </Box>
      </Box>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}
        slotProps={{ paper: { sx: { '& .MuiMenuItem-root': { fontSize: 13 } } } }}>
        {menu && (
          <MenuItem onClick={() => startRename(menu.session)}>
            <ListItemIcon>
              <EditOutlinedIcon fontSize="small" />
            </ListItemIcon>
            제목 변경
          </MenuItem>
        )}
        <MenuItem onClick={() => exportSession(menu.session)}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          대화내역 저장
        </MenuItem>
        {menu && (
          <MenuItem onClick={() => removeSession(menu.session)} sx={{ color: 'error.main' }}>
            <ListItemIcon>
              <DeleteOutlineIcon fontSize="small" sx={{ color: 'error.main' }} />
            </ListItemIcon>
            삭제
          </MenuItem>
        )}
      </Menu>

      {/* 새 세션: 폰과 같은 항목(모드·언어·이름)을 한 화면에 */}
      <Dialog open={dlg} onClose={() => setDlg(false)} slotProps={{ paper: { sx: { width: '100%', maxWidth: 480, m: 2, backgroundImage: 'none' } } }}>
        <Box sx={{ p: '24px 24px 20px', display: 'flex', flexDirection: 'column', gap: 1.25, overflowY: 'auto' }}>
          <Typography component="h2" sx={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.015em', mb: 0.75 }}>{t('newSession')}</Typography>
          <Box role="radiogroup" aria-label={t('newSession')} sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <OptionCard Icon={ArrowRightIcon} title={t('modeOneway')} desc={t('modeOnewayDesc')} sel={preset === 'oneway'} onClick={() => setPreset('oneway')} />
            <OptionCard Icon={SwapIcon} title={t('modeTwoway')} desc={t('modeTwowayDesc')} sel={preset === 'twoway'} onClick={() => setPreset('twoway')} />
            {/* 안내데스크 권한이 있는 계정만 */}
            {canDesk && <OptionCard Icon={HeadsetIcon} title={t('deskMode')} desc={t('deskModeDesc')} sel={preset === 'desk'} onClick={() => setPreset('desk')} />}
          </Box>
          {preset !== 'desk' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, mt: 0.75 }}>
              {langs.boxes(preset, t).map((x) => {
                const v = x.k === 'src' && x.value === 'auto' ? t('autoDetect') : t.lang(x.value);
                return (
                  <ButtonBase key={x.k} onClick={() => setLangPick(x)} aria-label={`${x.caption}: ${v}`}
                    sx={{ height: 66, borderRadius: '16px', border: 2, borderColor: 'divider', flexDirection: 'column', gap: 0.25, px: 1, '&:hover': { borderColor: 'text.disabled' } }}>
                    <Typography component="span" sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>{x.caption}</Typography>
                    <Typography component="span" noWrap sx={{ fontSize: 16.5, fontWeight: 800, maxWidth: '100%' }}>{v}</Typography>
                  </ButtonBase>
                );
              })}
            </Box>
          )}
          <Box component="label" sx={{ display: 'flex', alignItems: 'center', px: 2, height: 54, mt: 0.75, borderRadius: '16px', bgcolor: (th) => alpha(th.palette.text.primary, 0.04) }}>
            <InputBase value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} placeholder={namePlaceholder}
              inputProps={{ 'aria-label': t('sessionName'), maxLength: 80 }} sx={{ flex: 1, fontSize: 16 }} />
          </Box>
          <Box sx={{ display: 'flex', gap: 1, mt: 1.25 }}>
            <ButtonBase onClick={() => setDlg(false)} sx={{ flex: '0 0 32%', height: 52, borderRadius: '16px', bgcolor: (th) => alpha(th.palette.text.primary, 0.06), fontSize: 15.5, fontWeight: 700 }}>{t('cancel')}</ButtonBase>
            <ButtonBase onClick={create} disabled={creating} sx={{ flex: 1, height: 52, borderRadius: '16px', bgcolor: BRAND, color: '#fff', fontSize: 15.5, fontWeight: 700, opacity: creating ? 0.6 : 1 }}>{t('create')}</ButtonBase>
          </Box>
        </Box>
      </Dialog>
      <PickSheet open={!!langPick} onClose={() => setLangPick(null)} title={langPick?.caption} value={langPick?.value}
        options={langOptions(langPick?.codes || [], t)}
        onPick={(v) => langs.pickLang(langPick.k, v)} />

      {/* 이름 변경 */}
      <FormSheet open={!!rename} onClose={() => setRename(null)} title={t('renameShort')} initial={{ title: rename?.val || '' }}
        fields={[{ key: 'title', label: t('sessionName') }]} onSubmit={async (v) => saveRename(rename.id, v.title)} />

      <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <MuiAlert elevation={6} variant="filled" severity={snack.ok ? 'success' : 'error'} onClose={() => setSnack(null)}>
            {snack.msg}
          </MuiAlert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
