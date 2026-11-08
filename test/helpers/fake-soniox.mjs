/* 가짜 Soniox 엔진(WS 서버) — 파이프라인 테스트용.
   서버(server.js)를 SONIOX_WS_URL=이곳 으로 띄우면 실 엔진 대신 여기에 붙는다(무과금·결정적).
   프로토콜(서버가 기대하는 것만 최소 구현):
   - 연결(업그레이드) 요청 헤더 → conn.headers 로 캡처(인증은 Authorization: Bearer <키>)
   - 연결 직후 서버가 config JSON(텍스트 1건)을 보낸다 → conn.config 로 캡처
   - 이후 바이너리 = 오디오(집계만), JSON 글자 = conn.texts(에이전트 텍스트 등), 빈 텍스트 = 종료 신호
   - 테스트가 conn.sendTokens([...]) 로 토큰 이벤트를 재생: { text, is_final, language, confidence, translation_status }
   - conn.end() = <end> 토큰(발화 확정 트리거) */
import { WebSocketServer } from 'ws';

/* opts.autoClose: 연결되자마자 끊는다 — 엔진 장애(연결 즉시 종료)를 재현해
   서버의 재연결 백오프·상한을 검증하는 데 쓴다. */
export async function startFakeSoniox(opts = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((res) => wss.once('listening', res));
  const connections = [];
  const waiters = [];
  wss.on('connection', (ws, req) => {
    let resolveConfig;
    const conn = {
      ws,
      headers: req.headers,
      config: null,
      audioBytes: 0,
      loudFrames: 0, // 소리가 담긴 오디오 조각 수
      texts: [],     // config 뒤에 받은 JSON 글자 메시지
      closed: false,
      waitConfig: null,
      sendTokens(tokens) { ws.send(JSON.stringify({ tokens })); },
      end() { ws.send(JSON.stringify({ tokens: [{ text: '<end>', is_final: true }] })); },
      error(code, msg) { ws.send(JSON.stringify({ error_code: code, error_message: msg || '' })); },
      close() { try { ws.close(); } catch {} },
    };
    conn.waitConfig = new Promise((r) => { resolveConfig = r; });
    ws.on('message', (data, isBinary) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (!conn.config) {
        try { conn.config = JSON.parse(buf.toString()); resolveConfig(conn.config); return; } catch {}
      }
      // config 뒤의 글자 메시지(에이전트 텍스트 등) — 빈 문자열(종료 신호)은 건너뜀
      if (!isBinary) { try { conn.texts.push(JSON.parse(buf.toString())); } catch {} return; }
      conn.audioBytes += buf.length;
      // 소리가 담긴 조각 수(음소거·게이트로 무음이 된 조각은 세지 않는다) — 음소거 회귀 테스트용
      let loud = false;
      for (let i = 0; i + 1 < buf.length; i += 2) { const v = buf.readInt16LE(i); if (v > 200 || v < -200) { loud = true; break; } }
      if (loud) conn.loudFrames++;
    });
    ws.on('close', () => { conn.closed = true; });
    ws.on('error', () => {});
    connections.push(conn);
    if (waiters.length) waiters.shift()(conn);
    if (opts.autoClose) setImmediate(() => { try { ws.close(); } catch {} });
  });
  let claimed = 0; // nextConnection() 이 같은 연결을 두 번 반환하지 않게
  return {
    url: `ws://127.0.0.1:${wss.address().port}`,
    connections,
    nextConnection(timeoutMs = 8000) {
      if (claimed < connections.length) return Promise.resolve(connections[claimed++]);
      return new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('fake-soniox: 연결 대기 시간 초과')), timeoutMs);
        waiters.push((c) => { clearTimeout(to); claimed++; res(c); });
      });
    },
    close: () => new Promise((r) => { for (const c of connections) c.close(); wss.close(() => r()); }),
  };
}
