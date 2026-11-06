import React from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import { BRAND } from './brand.js';

/* 공용 확인 창 — 브라우저 기본 confirm() 대체. 모양은 폰 확인 창(phone/common.jsx)과 같다.
   사용: const [confirmReq, setConfirmReq] = useState(null);
        setConfirmReq({ title, message, confirmLabel, onOk: () => {...} });
        <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} /> */
export default function ConfirmDialog({ req, onClose }) {
  const ok = () => { const fn = req && req.onOk; onClose(); if (fn) fn(); };
  const danger = !(req && req.color) || req.color === 'error';
  return (
    <Dialog open={!!req} onClose={onClose} slotProps={{ paper: { sx: { borderRadius: '24px', border: 0, m: 3.5, width: '100%', maxWidth: 360, backgroundImage: 'none' } } }}>
      <Box role="alertdialog" aria-label={(req && req.title) || '확인'} sx={{ p: '24px 20px 18px', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Typography component="h2" sx={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.015em', textAlign: 'center', wordBreak: 'keep-all' }}>{(req && req.title) || '확인'}</Typography>
        <Typography sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'center', lineHeight: 1.55, wordBreak: 'keep-all', whiteSpace: 'pre-line' }}>{req && req.message}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25, mt: 1 }}>
          <ButtonBase onClick={onClose} sx={{ height: 50, borderRadius: '14px', bgcolor: 'action.hover', fontSize: 15, fontWeight: 700 }}>취소</ButtonBase>
          <ButtonBase autoFocus onClick={ok} sx={{ height: 50, borderRadius: '14px', bgcolor: danger ? 'error.main' : BRAND, color: '#fff', fontSize: 15, fontWeight: 700 }}>
            {(req && req.confirmLabel) || '삭제'}
          </ButtonBase>
        </Box>
      </Box>
    </Dialog>
  );
}
