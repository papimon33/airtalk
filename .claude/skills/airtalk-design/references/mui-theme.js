/* AirTalk MUI 테마 — React + MUI(v6+) 프로젝트에 그대로 복사해 쓴다. 원본: translate/client/src/shared/theme.js(brand: true 경로)
   사용:
     import { buildAirtalkTheme } from './airtalkTheme';
     const theme = useMemo(() => buildAirtalkTheme(mode), [mode]);   // mode = 'light' | 'dark'
     <ThemeProvider theme={theme}><CssBaseline />…</ThemeProvider>
   글꼴(Pretendard)은 index.html 에 링크한다 — tokens.css 맨 위 @import 참고. */
import { createTheme, alpha } from '@mui/material/styles';

export const BRAND = '#5B4FE8';
export const BRAND_DARK = '#4A3FD4';
export const BRAND_SOFT = '#EEEDFC';
export const BAR_BG = (th) => (th.palette.mode === 'dark' ? '#2B2D31' : '#F1F1F4');       // 조작 바·묶음
export const SOFT_BG = (th) => (th.palette.mode === 'dark' ? alpha(BRAND, 0.28) : BRAND_SOFT); // 켜짐·선택 칸
export const HOVER = (th) => alpha(th.palette.text.primary, 0.07);
export const SETTINGS_BG = (th) => (th.palette.mode === 'dark' ? th.palette.background.default : '#F4F3EF');
export const MENU_PAPER = { borderRadius: '12px', border: 0, backgroundImage: 'none', boxShadow: '0 12px 32px rgba(0,0,0,0.18)', py: 0.75 };

export function buildAirtalkTheme(mode = 'light') {
  const dark = mode === 'dark';
  const primary = dark ? '#8579FF' : BRAND;
  const primaryHover = dark ? '#9A90FF' : BRAND_DARK;
  const bgDefault = dark ? '#1F1E1D' : '#FFFFFF';
  const bgPaper = dark ? '#30302E' : '#FFFFFF';
  const divider = dark ? 'rgba(250,249,245,0.10)' : 'rgba(31,30,29,0.12)';
  const textPrimary = dark ? '#FAF9F5' : '#1F1E1D';
  const textSecondary = dark ? '#B3B1A9' : '#6B6A63';

  return createTheme({
    palette: {
      mode,
      primary: { main: primary, contrastText: '#FFFFFF' },
      success: { main: dark ? '#2EB67D' : '#007A5A' },
      error: { main: dark ? '#F47C7C' : '#E01E5A' },
      warning: { main: dark ? '#E8A03E' : '#E8912D' },
      accent: { main: dark ? '#84B5FF' : '#2E6FD8' }, // 상대방 말풍선 등 보조 강조
      divider,
      background: { default: bgDefault, paper: bgPaper },
      text: { primary: textPrimary, secondary: textSecondary },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: "'Pretendard', 'Noto Sans KR', system-ui, 'Segoe UI', sans-serif",
      fontSize: 14,
      h5: { fontWeight: 800, letterSpacing: '-0.02em' },
      h6: { fontWeight: 800, letterSpacing: '-0.015em', fontSize: 18 },
      subtitle1: { fontWeight: 700 },
      subtitle2: { fontWeight: 700 },
      button: { fontWeight: 700, letterSpacing: 0, fontSize: 14 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: bgDefault },
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': { background: alpha(dark ? '#fff' : '#000', 0.16), borderRadius: 8, border: '2px solid transparent', backgroundClip: 'padding-box' },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { textTransform: 'none', borderRadius: 12, paddingInline: 14, fontSize: 14 },
          containedPrimary: { backgroundColor: primary, color: '#FFFFFF', boxShadow: 'none', '&:hover': { backgroundColor: primaryHover, boxShadow: 'none' } },
          outlined: { borderColor: divider, '&:hover': { borderColor: alpha(textPrimary, 0.3), backgroundColor: alpha(textPrimary, 0.03) } },
        },
      },
      MuiCard: { styleOverrides: { root: { borderRadius: 12, border: `1px solid ${divider}`, backgroundImage: 'none', boxShadow: 'none' } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: divider } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: alpha(textPrimary, 0.3) },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1.5 },
          },
        },
      },
      MuiMenu: { styleOverrides: { paper: { borderRadius: 12, border: 0, marginTop: 6, boxShadow: '0 12px 32px rgba(0,0,0,0.18)' } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 24, border: 0 } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { borderRadius: 8, fontSize: 12.5, fontWeight: 500, paddingBlock: 7, paddingInline: 11, maxWidth: 300, lineHeight: 1.55, backgroundColor: dark ? '#2E2C36' : '#1D1C1D', color: '#fff' },
        },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: 6 } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 700 } } },
      MuiSwitch: {
        styleOverrides: {
          switchBase: { '&.Mui-checked': { color: '#fff' }, '&.Mui-checked + .MuiSwitch-track': { backgroundColor: primary, opacity: 1 } },
        },
      },
      MuiSlider: { styleOverrides: { root: { color: primary } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiTableCell: { styleOverrides: { root: { borderColor: divider } } },
    },
  });
}
