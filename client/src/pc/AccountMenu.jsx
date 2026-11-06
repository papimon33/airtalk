// PC 오른쪽 위 설정 — 폰과 같은 설정·계정 화면(오른쪽 패널) + PC 전용 줄(관리자·앱 설치)
import React, { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { SettingsIcon } from '../shared/icons.jsx';
import { useT } from '../shared/i18n.js';
import { Group, OptionRow } from '../phone/common.jsx';
import { OptionsScreen, AccountScreen } from '../phone/OptionsScreen.jsx';
import DesktopAppDialog from './DesktopAppDialog.jsx';

export default function AccountMenu({ user, onAdmin, onLogout, onUserUpdate }) {
  const t = useT();
  const [screen, setScreen] = useState(null); // null | 'options' | 'account'
  const [desktopApp, setDesktopApp] = useState(false); // 데스크톱 앱 안내·다운로드 창
  const isAdmin = user?.role === 'admin';
  return (
    <>
      <Tooltip title={t('settings')}>
        <IconButton aria-label={t('settings')} onClick={() => setScreen('options')} sx={{ width: 44, height: 44, borderRadius: '12px', color: 'text.primary', '& svg': { fontSize: 24 } }}>
          <SettingsIcon />
        </IconButton>
      </Tooltip>
      <OptionsScreen open={!!screen} onBack={() => setScreen(null)} user={user || {}} onAccount={() => setScreen('account')} onLogout={onLogout}
        extra={(
          <Group>
            {isAdmin && <OptionRow label={t('adminPage')} onClick={() => { setScreen(null); onAdmin(); }} />}
            <OptionRow label={t('installApp')} onClick={() => setDesktopApp(true)} />
          </Group>
        )} />
      <AccountScreen open={screen === 'account'} onBack={() => setScreen('options')} user={user || {}} onUser={onUserUpdate} onDeleted={onLogout} />
      <DesktopAppDialog open={desktopApp} onClose={() => setDesktopApp(false)} />
    </>
  );
}
