/* PC 설정 창 — 폰 설정과 같은 항목을 웹 방식으로(가운데 창 + 왼쪽 분류, 2026-11-08).
   일반(시스템 언어·모국어) · 음성(TTS 음성, 권한 있을 때) · 화면(테마·텍스트 크기) · 계정(사용자명·비밀번호·계정 삭제).
   값은 prefs.js(기기 저장 + 계정 동기화) — 폰 설정과 같은 저장소. */
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Snackbar from '@mui/material/Snackbar';
import CircularProgress from '@mui/material/CircularProgress';
import { alpha } from '@mui/material/styles';
import { api } from '../shared/api.js';
import { can } from '../shared/authState.js';
import { usePrefs, setPref } from '../shared/prefs.js';
import { useT, endonym } from '../shared/i18n.js';
import { SX_LANGS } from '../session/TranslateView.jsx';
import { FormSheet } from '../phone/common.jsx';
import { BRAND, BRAND_SOFT } from '../shared/brand.js';
import { PlayIcon } from '../shared/icons.jsx';

const UI_NAMES = { ko: '한국어', en: 'English', ja: '日本語' };
const NAV_BG = (th) => (th.palette.mode === 'dark' ? '#26262A' : '#F5F5F7');
const SOFT = (th) => (th.palette.mode === 'dark' ? alpha(BRAND, 0.28) : BRAND_SOFT);

// 한 줄: 왼쪽 이름(+설명), 오른쪽 조절
function Field({ label, desc, children, stack }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'stretch' : 'center', gap: stack ? 1.25 : 2, py: 1.75 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{label}</Typography>
        {desc && <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25, wordBreak: 'keep-all' }}>{desc}</Typography>}
      </Box>
      <Box sx={{ flex: 'none', ...(stack ? {} : { minWidth: 200, display: 'flex', justifyContent: 'flex-end' }) }}>{children}</Box>
    </Box>
  );
}
// 두세 개 중 하나(테마·목소리)
function Segmented({ value, options, onChange, label }) {
  return (
    <Box role="radiogroup" aria-label={label} sx={{ display: 'inline-flex', p: 0.5, gap: 0.5, borderRadius: '10px', bgcolor: (th) => alpha(th.palette.text.primary, 0.06) }}>
      {options.map((o) => {
        const on = o.code === value;
        return (
          <ButtonBase key={o.code} role="radio" aria-checked={on} onClick={() => onChange(o.code)}
            sx={{ height: 32, px: 1.75, borderRadius: '8px', fontSize: 13.5, fontWeight: on ? 700 : 500, bgcolor: on ? 'background.paper' : 'transparent', color: on ? 'text.primary' : 'text.secondary', boxShadow: on ? '0 1px 3px rgba(0,0,0,0.12)' : 'none' }}>
            {o.label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
const selSx = { minWidth: 200, '& .MuiSelect-select': { py: 0.9, fontSize: 14 } };

export default function SettingsDialog({ open, onClose, user, onUser, onDeleted, initialTab = 'general' }) {
  const t = useT();
  const prefs = usePrefs();
  const [tab, setTab] = useState(initialTab);
  const [toast, setToast] = useState('');
  const [previewing, setPreviewing] = useState(null);
  const [name, setName] = useState('');
  const [pw, setPw] = useState({ cur: '', pw: '', pw2: '' });
  const [pwErr, setPwErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [delAsk, setDelAsk] = useState(false);
  const isAdmin = user && user.role === 'admin'; // 관리자는 서버 설정 계정 — 사용자명·비밀번호·삭제 불가
  useEffect(() => {
    if (!open) return;
    setTab(initialTab); setName((user && user.username) || ''); setPw({ cur: '', pw: '', pw2: '' }); setPwErr('');
    // eslint-disable-next-line
  }, [open]);

  const tabs = [
    { k: 'general', label: t('general') },
    ...(can('tts') ? [{ k: 'voice', label: t('secVoice') }] : []),
    { k: 'display', label: t('secDisplay') },
    { k: 'account', label: t('account') },
  ];
  const voiceName = (g) => (g === 'm' ? t('male') : t('female'));
  const preview = async (g) => {
    if (previewing) return;
    setPreviewing(g);
    try {
      let blob;
      try { blob = await api.ttsPreview(prefs.nativeLang, g); } catch { blob = await api.ttsPreview('ko', g); }
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch { setToast(t('previewFail')); }
    finally { setPreviewing(null); }
  };
  const saveMe = async (body) => { const r = await api.updateMe(body); if (r && r.user && onUser) onUser({ ...user, ...r.user }); return r; };
  const saveName = async () => {
    const v = name.trim();
    if (!v) { setToast(t('required', { f: t('username') })); return; }
    setBusy(true);
    try { await saveMe({ username: v }); setToast(t('saved')); } catch (e) { setToast(e.message || t('netError')); } finally { setBusy(false); }
  };
  const savePw = async () => {
    const err = !pw.cur ? t('required', { f: t('currentPassword') }) : !pw.pw ? t('required', { f: t('newPassword') }) : pw.pw !== pw.pw2 ? t('pwMismatch') : '';
    setPwErr(err);
    if (err) return;
    setBusy(true);
    try { await saveMe({ currentPassword: pw.cur, password: pw.pw, passwordConfirm: pw.pw2 }); setPw({ cur: '', pw: '', pw2: '' }); setToast(t('pwChanged')); }
    catch (e) { setPwErr(e.message || t('netError')); }
    finally { setBusy(false); }
  };
  const title = (tabs.find((x) => x.k === tab) || tabs[0]).label;

  return (
    <Dialog open={open} onClose={onClose} maxWidth={false}
      slotProps={{ paper: { 'aria-label': t('settings'), sx: { width: 760, maxWidth: 'calc(100vw - 32px)', height: 540, maxHeight: 'calc(100vh - 32px)', m: 2, borderRadius: '16px', border: 0, backgroundImage: 'none', display: 'flex', flexDirection: 'row', overflow: 'hidden' } } }}>
      <Box component="nav" sx={{ width: 196, flex: 'none', bgcolor: NAV_BG, p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Typography component="h2" sx={{ fontSize: 15, fontWeight: 800, px: 1.25, pt: 0.75, pb: 1.25 }}>{t('settings')}</Typography>
        {tabs.map((x) => (
          <ButtonBase key={x.k} onClick={() => setTab(x.k)} aria-current={tab === x.k ? 'page' : undefined}
            sx={{ justifyContent: 'flex-start', height: 36, px: 1.25, borderRadius: '8px', fontSize: 14, fontWeight: tab === x.k ? 700 : 500, color: tab === x.k ? BRAND : 'text.primary', bgcolor: tab === x.k ? SOFT : 'transparent', '&:hover': { bgcolor: tab === x.k ? SOFT : (th) => alpha(th.palette.text.primary, 0.06) } }}>
            {x.label}
          </ButtonBase>
        ))}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', px: 3.5, pt: 2.5, pb: 0.5 }}>
          <Typography component="h3" sx={{ flex: 1, fontSize: 18, fontWeight: 800 }}>{title}</Typography>
          <IconButton onClick={onClose} aria-label={t('close')} sx={{ width: 34, height: 34, borderRadius: '10px', fontSize: 18 }}>✕</IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 3.5, pb: 3, '& > hr': { my: 0 } }}>
          {tab === 'general' && (
            <>
              <Field label={t('sysLang')} desc={t('sysLangDesc')}>
                <Select size="small" value={prefs.sysLang} onChange={(e) => setPref('sysLang', e.target.value)} sx={selSx} inputProps={{ 'aria-label': t('sysLang') }}>
                  {['ko', 'en', 'ja'].map((c) => <MenuItem key={c} value={c}>{UI_NAMES[c]}</MenuItem>)}
                </Select>
              </Field>
              <Divider />
              <Field label={t('nativeLang')} desc={t('nativeLangDesc')}>
                <Select size="small" value={prefs.nativeLang} onChange={(e) => setPref('nativeLang', e.target.value)} sx={selSx} inputProps={{ 'aria-label': t('nativeLang') }}
                  MenuProps={{ slotProps: { paper: { sx: { maxHeight: 360 } } } }}>
                  {SX_LANGS.map((l) => <MenuItem key={l.code} value={l.code}>{t.lang(l.code)}<Box component="span" sx={{ ml: 1, color: 'text.secondary', fontSize: 12.5 }}>{endonym(l.code) !== t.lang(l.code) ? endonym(l.code) : ''}</Box></MenuItem>)}
                </Select>
              </Field>
            </>
          )}

          {tab === 'voice' && (
            <Field label={t('ttsVoice')} desc={t('ttsVoiceDesc')}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Segmented label={t('ttsVoice')} value={prefs.ttsGender} onChange={(v) => setPref('ttsGender', v)} options={['f', 'm'].map((g) => ({ code: g, label: voiceName(g) }))} />
                <Button size="small" onClick={() => preview(prefs.ttsGender)} startIcon={previewing ? <CircularProgress size={13} color="inherit" /> : <PlayIcon sx={{ fontSize: 14 }} />}
                  sx={{ height: 40, bgcolor: SOFT, color: BRAND, fontWeight: 700, '&:hover': { bgcolor: SOFT } }}>{t('preview')}</Button>
              </Box>
            </Field>
          )}

          {tab === 'display' && (
            <>
              <Field label={t('theme')}>
                <Segmented label={t('theme')} value={prefs.theme} onChange={(v) => setPref('theme', v)}
                  options={[{ code: 'light', label: t('themeLight') }, { code: 'dark', label: t('themeDark') }, { code: 'system', label: t('themeSystem') }]} />
              </Field>
              <Divider />
              <Field label={t('textSize')} desc={t('textSizeDesc')} stack>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 0.5 }}>
                  <Typography aria-hidden="true" sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>{t('sampleGlyph')}</Typography>
                  <Slider value={prefs.fontScale} min={0.8} max={1.6} step={0.1} marks aria-label={t('textSize')}
                    onChange={(e, v) => setPref('fontScale', Math.round(v * 10) / 10)} sx={{ color: BRAND }} />
                  <Typography aria-hidden="true" sx={{ fontSize: 18, fontWeight: 700, color: 'text.secondary' }}>{t('sampleGlyph')}</Typography>
                  <Typography sx={{ width: 44, textAlign: 'right', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Math.round(prefs.fontScale * 100)}%</Typography>
                </Box>
                <Box sx={{ mt: 0.5, p: 2, borderRadius: '12px', bgcolor: (th) => alpha(th.palette.text.primary, 0.04) }}>
                  <Typography sx={{ fontSize: Math.round(22 * prefs.fontScale), fontWeight: 500, lineHeight: 1.45 }}>{t('textSample')}</Typography>
                  <Typography sx={{ fontSize: Math.round(14.5 * prefs.fontScale), color: 'text.secondary', mt: 0.5 }}>{t('textSampleSrc')}</Typography>
                </Box>
              </Field>
            </>
          )}

          {tab === 'account' && user && (
            <>
              <Field label="ID"><Typography sx={{ fontSize: 14, color: 'text.secondary' }}>{user.id}{isAdmin ? ` · ${t('adminRole')}` : ''}</Typography></Field>
              <Divider />
              <Field label={t('username')} desc={isAdmin ? t('adminManaged') : ''}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField size="small" value={isAdmin ? (user.username || user.id) : name} onChange={(e) => setName(e.target.value)} disabled={isAdmin}
                    inputProps={{ 'aria-label': t('username'), maxLength: 40 }} sx={{ width: 180 }} />
                  {!isAdmin && <Button variant="contained" onClick={saveName} disabled={busy || name.trim() === (user.username || '')}>{t('save')}</Button>}
                </Box>
              </Field>
              {!isAdmin && (
                <>
                  <Divider />
                  <Field label={t('changePassword')} desc={t('pwChangeDesc')} stack>
                    <Box component="form" onSubmit={(e) => { e.preventDefault(); savePw(); }} sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
                      <TextField size="small" type="password" label={t('currentPassword')} value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} autoComplete="current-password" />
                      <TextField size="small" type="password" label={t('newPassword')} value={pw.pw} onChange={(e) => setPw({ ...pw, pw: e.target.value })} autoComplete="new-password" />
                      <TextField size="small" type="password" label={t('confirmPassword')} value={pw.pw2} onChange={(e) => setPw({ ...pw, pw2: e.target.value })} autoComplete="new-password" />
                      <Box sx={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Button type="submit" variant="contained" disabled={busy}>{t('changePassword')}</Button>
                        {pwErr && <Typography role="alert" sx={{ fontSize: 13, color: 'error.main' }}>{pwErr}</Typography>}
                      </Box>
                    </Box>
                  </Field>
                  <Divider />
                  <Field label={t('deleteAccount')} desc={t('deleteAccountShort')}>
                    <Button variant="outlined" color="error" onClick={() => setDelAsk(true)}>{t('deleteAccount')}</Button>
                  </Field>
                </>
              )}
            </>
          )}
        </Box>
      </Box>

      <FormSheet open={delAsk} onClose={() => setDelAsk(false)} title={t('deleteAccount')} subtitle={t('deleteAccountDesc')} danger okLabel={t('deleteAccount')}
        fields={[{ key: 'pw', label: t('currentPassword'), type: 'password', autoComplete: 'current-password' }]}
        validate={(v) => (v.pw ? '' : t('required', { f: t('currentPassword') }))}
        onSubmit={async (v) => { await api.deleteMe(v.pw); onDeleted && onDeleted(); }} />
      <Snackbar open={!!toast} autoHideDuration={2400} onClose={() => setToast('')} message={toast} />
    </Dialog>
  );
}
