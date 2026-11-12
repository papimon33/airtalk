/* 앱 전역 보안 미들웨어 — index.js 가 구 server.js 와 같은 순서로 장착한다(HTTPS 리다이렉트 → 보안 헤더 → CSRF → JSON 바디 → static). */
import { isHttps } from './index.js';

// FORCE_HTTPS=1: http 접속을 https 로 301 리다이렉트(프록시 뒤에선 x-forwarded-proto 기준).
// Render 등 관리형 호스팅은 자체적으로 https 를 강제하므로 자가 호스팅에서만 필요.
// (index.js 가 FORCE_HTTPS=1 일 때만 장착)
export function forceHttps(req, res, next) {
  if (isHttps(req)) return next();
  // PUBLIC_HOST 가 설정돼 있으면 그 호스트로만 리다이렉트(스푸핑된 Host/X-Forwarded-Host 로 인한 오픈 리다이렉트 방지)
  const host = process.env.PUBLIC_HOST || String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host || /^(localhost|127\.)/.test(host)) return next(); // 로컬 개발은 예외
  return res.redirect(301, `https://${host}${req.originalUrl}`);
}

// 보안 헤더
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

// CSRF 완화: /api 의 상태변경 요청은 동일 출처만 허용(쿠키 인증 보호)
export function csrfGuard(req, res, next) {
  // 경로는 소문자로 비교한다(라우터는 대소문자를 가리지 않아 /API/... 로 검사를 건너뛸 수 있었다)
  if (req.path.toLowerCase().startsWith('/api') && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE')) {
    // Origin 이 없으면 Referer 로 폴백 검사(둘 다 없으면 브라우저 발 요청이 아니므로 통과 — curl 등 API 클라이언트)
    const src = req.headers.origin || req.headers.referer;
    if (src && !sameOrigin(req, src)) return res.status(403).json({ error: 'cross-origin request blocked' });
  }
  next();
}
// 요청의 Origin(또는 Referer)이 이 서버의 주소와 같은가. 읽을 수 없는 값('null' — 샌드박스 프레임·파일 등)은 다른 출처로 본다.
// WebSocket 연결(realtime/index.js)도 같은 검사를 쓴다.
export function sameOrigin(req, src) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  let oh = '';
  try { oh = new URL(String(src)).host.toLowerCase(); } catch { return false; }
  return !!oh && oh === host;
}
