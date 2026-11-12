/* 로그인·로그아웃 + 관리자 2FA 설정 라우트 */
import crypto from 'crypto';
import QRCode from 'qrcode';
import { ADMIN_ID, ADMIN_PASSWORD } from '../config.js';
import { users } from '../store/index.js';
import { b32encode, totpVerify } from '../util/security_util.js';
import { requireAdmin, verifyPassword, findUser, publicUser, clearAuthCookie, securityCfg, saveSecurityCfg, adminTotpSecret, securityLoadFailed, LOGIN_WINDOW_MS, LOGIN_MAX_FAIL, LOGIN_ID_MAX, loginFails, loginKey, sweepLoginFails, deviceKind, activeLogin, setAuthCookie, authFromReq, closeLogin, closeAllLogins } from '../auth/index.js';

// 설정 진행 중 시크릿(코드 확인 후 저장) — 시작한 그 로그인에서만, 10분 안에 확인할 수 있다
let pending2fa = null; // { secret, jti, at }
const PENDING_2FA_MS = 10 * 60 * 1000;

export function registerAuthRoutes(app) {
  app.get('/api/admin/2fa', requireAdmin, (req, res) => res.json({ enabled: !!adminTotpSecret(), viaEnv: !!process.env.ADMIN_TOTP_SECRET }));
  app.post('/api/admin/2fa/setup', requireAdmin, async (req, res) => {
    if (process.env.ADMIN_TOTP_SECRET) return res.status(400).json({ error: '2FA 시크릿이 환경변수로 관리되고 있습니다.' });
    // 이미 켜져 있으면 새로 만들 수 없다 — 바꾸려면 지금 쓰는 코드로 먼저 해제해야 한다.
    // (예전엔 관리자 로그인만 있으면 현재 코드 없이 새 시크릿으로 덮어쓸 수 있었다. 2026-11-12 보안 점검)
    if (adminTotpSecret()) return res.status(409).json({ error: '2단계 인증이 이미 켜져 있습니다. 바꾸려면 먼저 해제하세요.' });
    const secret = b32encode(crypto.randomBytes(20));
    pending2fa = { secret, jti: req.auth.jti, at: Date.now() };
    const label = encodeURIComponent(`AirTalk:${req.user.id}`);
    const url = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('AirTalk')}`;
    try { res.json({ secret, qr: await QRCode.toDataURL(url, { width: 240, margin: 1 }) }); }
    catch (e) { res.status(500).json({ error: String(e) }); }
  });
  app.post('/api/admin/2fa/verify', requireAdmin, async (req, res) => {
    if (process.env.ADMIN_TOTP_SECRET) return res.status(400).json({ error: '2FA 시크릿이 환경변수로 관리되고 있습니다.' });
    if (adminTotpSecret()) return res.status(409).json({ error: '2단계 인증이 이미 켜져 있습니다. 바꾸려면 먼저 해제하세요.' });
    const p = pending2fa;
    if (!p || p.jti !== req.auth.jti || Date.now() - p.at > PENDING_2FA_MS) return res.status(400).json({ error: '먼저 2FA 설정을 시작하세요.' });
    if (!totpVerify(p.secret, (req.body || {}).code)) return res.status(400).json({ error: '인증 코드가 올바르지 않습니다. 앱의 6자리 코드를 다시 확인하세요.' });
    securityCfg.adminTotpSecret = p.secret; // gitleaks:allow — 비밀값이 아니라 변수끼리 대입(실행 중 만든 2FA 시크릿을 설정에 옮김)
    if (!(await saveSecurityCfg())) {
      securityCfg.adminTotpSecret = '';
      return res.status(500).json({ error: '2단계 인증 설정을 저장하지 못했습니다. 잠시 후 다시 시도하세요.' });
    }
    pending2fa = null;
    console.log('[2fa] 관리자 2FA 활성화됨');
    // 켜기 전에(비밀번호만으로) 로그인해 둔 다른 관리자 기기는 모두 로그아웃, 지금 기기는 새 토큰으로 계속
    closeAllLogins(ADMIN_ID, 'password');
    setAuthCookie(req, res, ADMIN_ID, req.auth.kind);
    res.json({ ok: true });
  });
  app.post('/api/admin/2fa/disable', requireAdmin, async (req, res) => {
    if (process.env.ADMIN_TOTP_SECRET) return res.status(400).json({ error: '2FA 시크릿이 환경변수로 관리되고 있습니다.' });
    if (!totpVerify(adminTotpSecret(), (req.body || {}).code)) return res.status(400).json({ error: '인증 코드가 올바르지 않습니다.' });
    const before = securityCfg.adminTotpSecret;
    securityCfg.adminTotpSecret = '';
    if (!(await saveSecurityCfg())) {
      securityCfg.adminTotpSecret = before;
      return res.status(500).json({ error: '2단계 인증 설정을 저장하지 못했습니다. 잠시 후 다시 시도하세요.' });
    }
    console.log('[2fa] 관리자 2FA 해제됨');
    res.json({ ok: true });
  });

  app.post('/api/login', (req, res) => {
    const b = req.body || {};
    const id = String(b.id || '').trim();
    const password = String(b.password || '');
    // 계정 ID 는 64자까지 — 더 긴 값은 있는 계정일 수 없으므로 기록(메모리·로그)에 남기지 않고 돌려보낸다
    if (id.length > LOGIN_ID_MAX) return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
    const key = loginKey(req, id);
    const now = Date.now();
    sweepLoginFails(now); // 기한 지난 실패 기록 정리 + 전체 상한
    let rec = loginFails.get(key);
    if (rec && rec.lockUntil && now < rec.lockUntil) {
      const sec = Math.ceil((rec.lockUntil - now) / 1000);
      return res.status(429).json({ error: `로그인 시도가 너무 많습니다. ${sec}초 후 다시 시도하세요.` });
    }
    if (rec && now - rec.first > LOGIN_WINDOW_MS) rec = null; // 윈도우 경과 → 초기화

    let user = null;
    if (id === ADMIN_ID) {
      const a = Buffer.from(password), e = Buffer.from(ADMIN_PASSWORD);
      if (a.length === e.length && crypto.timingSafeEqual(a, e)) user = findUser(ADMIN_ID);
    } else {
      const u = users.find((x) => x.id === id);
      if (verifyPassword(u, password)) user = u;
    }
    if (!user) {
      rec = rec || { count: 0, first: now, lockUntil: 0 };
      rec.count++;
      if (rec.count >= LOGIN_MAX_FAIL) rec.lockUntil = now + LOGIN_WINDOW_MS;
      loginFails.set(key, rec);
      console.warn(`[auth] 로그인 실패 id=${JSON.stringify(id)} ip=${key.split('|')[0]} (${rec.count}회)`);
      return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
    }
    // 관리자 2FA: 비밀번호 통과 후 OTP 코드 확인(활성화된 경우)
    if (user.role === 'admin') {
      // 저장된 2단계 인증 설정을 읽지 못했다 — 꺼진 것으로 보고 통과시키지 않는다
      if (securityLoadFailed && !process.env.ADMIN_TOTP_SECRET) {
        return res.status(503).json({ error: '2단계 인증 설정을 읽지 못해 관리자 로그인을 막았습니다. 서버 로그를 확인하세요.' });
      }
      if (adminTotpSecret()) {
        if (!b.otp) return res.status(401).json({ need2fa: true, error: '인증 앱의 6자리 코드를 입력하세요.' });
        if (!totpVerify(adminTotpSecret(), b.otp)) {
          rec = rec || { count: 0, first: now, lockUntil: 0 };
          rec.count++;
          if (rec.count >= LOGIN_MAX_FAIL) rec.lockUntil = now + LOGIN_WINDOW_MS;
          loginFails.set(key, rec);
          console.warn(`[auth] 2FA 코드 불일치 id=${JSON.stringify(id)} ip=${key.split('|')[0]}`);
          return res.status(401).json({ need2fa: true, error: '인증 코드가 올바르지 않습니다.' });
        }
      }
    }
    loginFails.delete(key); // 성공 시 초기화
    // 로그인 자리: 계정당 PC 1대 + 폰 1대. 같은 종류의 다른 기기에서 로그인 중이면 먼저 확인(화면이 확인 창 → replace 로 다시 요청)
    const kind = deviceKind(b.device);
    if (activeLogin(user.id, kind) && b.replace !== true) {
      return res.status(409).json({ confirmReplace: true, error: '다른 기기에서 사용 중인 계정입니다.' });
    }
    console.log(`[auth] 로그인 성공 id=${user.id} role=${user.role} device=${kind} ip=${key.split('|')[0]}`);
    setAuthCookie(req, res, user.id, kind, !!b.remember);
    res.json({ user: publicUser(user) });
  });
  app.post('/api/logout', (req, res) => {
    const a = authFromReq(req);
    if (a.user) closeLogin(a.user.id, a.kind, a.jti); // 자리를 비워 다음 로그인에 확인 창이 뜨지 않게
    clearAuthCookie(res);
    res.json({ ok: true });
  });
}
