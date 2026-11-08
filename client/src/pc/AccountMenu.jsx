// PC 오른쪽 위 계정 메뉴 — 이름 + ⌄ 를 누르면 작은 메뉴(설정·관리자 페이지·앱 설치·로그아웃). 설정은 가운데 창(SettingsDialog).
import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import { alpha } from '@mui/material/styles';
import { useT } from '../shared/i18n.js';
import { BRAND } from '../shared/brand.js';
import { ChevronRightIcon } from '../shared/icons.jsx';
import ConfirmDialog from '../shared/ConfirmDialog.jsx';
import DesktopAppDialog from './DesktopAppDialog.jsx';
import SettingsDialog from './SettingsDialog.jsx';

export function UserAvatar({ user, size = 30 }) {
  const ch = String((user && (user.username || user.id)) || '?').trim().charAt(0).toUpperCase();
  return (
    <Box aria-hidden="true" sx={{ width: size, height: size, flex: 'none', borderRadius: '999px', bgcolor: BRAND, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, fontWeight: 800 }}>{ch}</Box>
  );
}

export default function AccountMenu({ user, onAdmin, onLogout, onUserUpdate }) {
  const t = useT();
  const [anchor, setAnchor] = useState(null);
  const [settings, setSettings] = useState(false);
  const [desktopApp, setDesktopApp] = useState(false);
  const [logoutAsk, setLogoutAsk] = useState(null);
  const isAdmin = user?.role === 'admin';
  const pick = (fn) => () => { setAnchor(null); fn(); };
  return (
    <>
      <ButtonBase onClick={(e) => setAnchor(e.currentTarget)} aria-label={t('accountMenu')} aria-haspopup="true" aria-expanded={!!anchor}
        sx={{ height: 40, pl: 0.5, pr: 1, gap: 1, borderRadius: '999px', bgcolor: anchor ? (th) => alpha(th.palette.text.primary, 0.07) : 'transparent', '&:hover': { bgcolor: (th) => alpha(th.palette.text.primary, 0.07) } }}>
        <UserAvatar user={user} />
        <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 700, maxWidth: 160 }}>{user?.username || user?.id}</Typography>
        <ChevronRightIcon sx={{ fontSize: 14, color: 'text.secondary', transform: `rotate(${anchor ? -90 : 90}deg)` }} />
      </ButtonBase>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 0.75, minWidth: 220, borderRadius: '12px', border: 0, boxShadow: '0 12px 32px rgba(0,0,0,0.18)', '& .MuiMenuItem-root': { fontSize: 13.5, fontWeight: 600, minHeight: 34, mx: 0.75, borderRadius: '8px' } } } }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography noWrap sx={{ fontWeight: 800, fontSize: 14 }}>{user?.username || user?.id}</Typography>
          <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary' }}>{user?.id}{isAdmin ? ` · ${t('adminRole')}` : ''}</Typography>
        </Box>
        <Divider sx={{ my: '6px !important', mx: 1.5 }} />
        <MenuItem onClick={pick(() => setSettings(true))}>{t('settings')}</MenuItem>
        {isAdmin && <MenuItem onClick={pick(onAdmin)}>{t('adminPage')}</MenuItem>}
        <MenuItem onClick={pick(() => setDesktopApp(true))}>{t('installApp')}</MenuItem>
        <Divider sx={{ my: '6px !important', mx: 1.5 }} />
        <MenuItem onClick={pick(() => setLogoutAsk({ title: t('logoutConfirm'), confirmLabel: t('logout'), onOk: onLogout }))} sx={{ color: 'error.main' }}>{t('logout')}</MenuItem>
      </Menu>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} user={user} onUser={onUserUpdate} onDeleted={onLogout} />
      <DesktopAppDialog open={desktopApp} onClose={() => setDesktopApp(false)} />
      <ConfirmDialog req={logoutAsk} onClose={() => setLogoutAsk(null)} />
    </>
  );
}
