import os from 'os';

/* ------------------------------------------------------------------ */
/*  로컬 네트워크 IP (모바일 접속용)                                    */
/* ------------------------------------------------------------------ */
export function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// 접속 주소 — Express 의 req.ip 와 같은 규칙(앞단 프록시 hops 단계만 믿는다)을 WebSocket 연결에도 쓴다.
// 예전엔 WebSocket 쪽만 X-Forwarded-For 의 맨 앞 값(보내는 쪽이 마음대로 적을 수 있다)을 그대로 썼다(2026-11-12 보안 점검).
export function clientIp(req, hops) {
  const chain = [String((req.socket && req.socket.remoteAddress) || '')];
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  for (let i = xff.length - 1; i >= 0; i--) chain.push(xff[i]);
  return chain[Math.min(Math.max(0, hops), chain.length - 1)] || '';
}
