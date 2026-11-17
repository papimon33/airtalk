/* Soniox 로 보내는 음성을 Opus(Ogg) 로 압축 — 해외로 나가는 전송량을 PCM(시간당 약 173MB) 대비 약 1/11(32kbps 기준 약 15MB)로 줄인다.
   2026-11-17 실측(실제 엔진, 같은 음성 동시 전송): 한국어·중국어 합성 음성은 인식 결과가 PCM 과 같았고(오류율 차이 0~0.1%p),
   대만 실제 영상 9분 39초는 PCM 끼리 두 번 돌린 차이(3.5%)보다 PCM–Opus 차이(2.5~3.4%)가 작았다. 첫 글자·확정 지연도 차이 0.1초 안.
   서버 경로 시험(한국어 연설 52초, 세 번)에서 24kbps 는 '저고도'를 매번 '적어도'로 들었고 32kbps 는 PCM 과 같았다 → 기본값 32kbps.
   끄기: SONIOX_AUDIO_CODEC=pcm (다시 배포 없이 환경변수만). 비트레이트: SONIOX_OPUS_BITRATE(12000~64000).

   동작: openSonioxWs() 가 돌려주는 소켓의 send 를 감싼다 — 파이프라인 코드는 지금처럼 config(JSON) → PCM 조각을 보내면 된다.
   · 첫 글자 메시지(config): audio_format 을 'auto' 로 바꾸고 sample_rate·num_channels 를 뺀 뒤 Ogg 머리 페이지 2개(OpusHead·OpusTags)를 이어 보낸다.
   · PCM 조각(24kHz 16bit 모노): 20ms 프레임으로 압축해 Ogg 페이지 하나로 보낸다. 20ms 가 안 되는 나머지는 다음 조각과 합친다.
   · 빈 문자열('', 종료·finalize 신호): 남은 나머지를 무음으로 채워 마저 보낸 뒤 신호를 보낸다(마지막 말끝 유실 방지).
   · 소켓마다 Ogg 스트림이 새로 시작된다(재연결·언어 재감지 시 새 소켓 = 새 머리 페이지). 닫히면 인코더를 해제한다. */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');

export const OPUS_RATE = 24000;             // 앱·서버 전체가 쓰는 PCM 표본율
const FRAME = 480;                          // 20ms @ 24kHz
const FRAME_BYTES = FRAME * 2;
const GRANULE_PER_FRAME = 960;              // Ogg Opus granule 은 48kHz 기준
const PRE_SKIP = 312;                       // 48kHz 기준 인코더 지연(약 6.5ms)
const MAX_PACKETS_PER_PAGE = 50;            // 한 페이지의 lacing 값(255개 상한) 안쪽으로

// ---- Ogg 페이지 ----
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let k = 0; k < 8; k++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
  CRC_TABLE[i] = r >>> 0;
}
export function oggCrc(buf) {
  let c = 0;
  for (const x of buf) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ x) & 0xff]) >>> 0;
  return c >>> 0;
}
export function oggPage(packets, { granule, serial, seq, bos = false, eos = false }) {
  const lacing = [];
  for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
  const head = Buffer.alloc(27 + lacing.length);
  head.write('OggS', 0);
  head[4] = 0;                                   // 버전
  head[5] = (bos ? 2 : 0) | (eos ? 4 : 0);
  head.writeBigInt64LE(BigInt(granule), 6);
  head.writeUInt32LE(serial, 14);
  head.writeUInt32LE(seq, 18);
  head.writeUInt32LE(0, 22);                     // CRC 자리
  head[26] = lacing.length;
  Buffer.from(lacing).copy(head, 27);
  const page = Buffer.concat([head, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

// ---- Opus 인코더 + Ogg 먹서 ----
export class OggOpusEncoder {
  constructor(bitrate = 32000) {
    this.enc = new OpusScript(OPUS_RATE, 1, OpusScript.Application.VOIP);
    this.enc.setBitrate(bitrate);
    this.serial = crypto.randomInt(1, 2 ** 31);
    this.seq = 0;
    this.granule = 0;
    this.rest = Buffer.alloc(0);
    this.closed = false;
  }
  header() {
    const head = Buffer.alloc(19);
    head.write('OpusHead', 0);
    head[8] = 1;                                 // 버전
    head[9] = 1;                                 // 채널 수
    head.writeUInt16LE(PRE_SKIP, 10);
    head.writeUInt32LE(OPUS_RATE, 12);           // 원본 표본율(참고값)
    head.writeInt16LE(0, 16);                    // 출력 이득
    head[18] = 0;                                // 채널 매핑 0(모노·스테레오)
    const vendor = Buffer.from('airtalk');
    const vlen = Buffer.alloc(4); vlen.writeUInt32LE(vendor.length, 0);
    const tags = Buffer.concat([Buffer.from('OpusTags'), vlen, vendor, Buffer.alloc(4)]);
    return Buffer.concat([
      oggPage([head], { granule: 0, serial: this.serial, seq: this.seq++, bos: true }),
      oggPage([tags], { granule: 0, serial: this.serial, seq: this.seq++ }),
    ]);
  }
  // PCM(16bit LE 모노 24kHz) → 압축된 Ogg 페이지(Buffer) 또는 null(20ms 미만이라 아직 보낼 것 없음)
  encode(pcm) {
    if (this.closed) return null;
    let buf = this.rest.length ? Buffer.concat([this.rest, pcm]) : pcm;
    const usable = buf.length - (buf.length % FRAME_BYTES);
    this.rest = Buffer.from(buf.subarray(usable)); // 복사(원본 조각을 붙잡지 않게)
    if (!usable) return null;
    return this._pages(buf.subarray(0, usable));
  }
  // 남은 나머지(20ms 미만)를 무음으로 채워 마저 압축 — 종료 신호 직전에 부른다
  flush() {
    if (this.closed || !this.rest.length) return null;
    const frame = Buffer.alloc(FRAME_BYTES);
    this.rest.copy(frame);
    this.rest = Buffer.alloc(0);
    return this._pages(frame);
  }
  _pages(pcm) {
    const out = [];
    let packets = [];
    for (let o = 0; o < pcm.length; o += FRAME_BYTES) {
      packets.push(Buffer.from(this.enc.encode(pcm.subarray(o, o + FRAME_BYTES), FRAME)));
      this.granule += GRANULE_PER_FRAME;
      if (packets.length >= MAX_PACKETS_PER_PAGE) {
        out.push(oggPage(packets, { granule: this.granule, serial: this.serial, seq: this.seq++ }));
        packets = [];
      }
    }
    if (packets.length) out.push(oggPage(packets, { granule: this.granule, serial: this.serial, seq: this.seq++ }));
    return out.length === 1 ? out[0] : Buffer.concat(out);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.enc.delete(); } catch {}
  }
}

// ---- Soniox 소켓 감싸기 ----
// codec !== 'opus' 이면 소켓을 그대로 돌려준다(PCM 그대로 전송).
export function wrapSonioxSocket(ws, { codec = 'opus', bitrate = 32000 } = {}) {
  if (codec !== 'opus') return ws;
  const rawSend = ws.send.bind(ws);
  let enc = null;
  let closed = false;
  ws.send = (data, ...rest) => {
    if (typeof data === 'string') {
      if (!enc && !closed) {
        let cfg = null;
        try { cfg = JSON.parse(data); } catch {}
        if (cfg && typeof cfg === 'object' && cfg.model) { // 첫 config
          cfg.audio_format = 'auto';
          delete cfg.sample_rate;
          delete cfg.num_channels;
          enc = new OggOpusEncoder(bitrate);
          rawSend(JSON.stringify(cfg), ...rest);
          return rawSend(enc.header());
        }
      }
      if (data === '' && enc) { const tail = enc.flush(); if (tail) rawSend(tail); }
      return rawSend(data, ...rest);
    }
    if (!enc) return rawSend(data, ...rest); // config 전 바이너리는 없어야 하지만, 오면 그대로
    const out = enc.encode(Buffer.isBuffer(data) ? data : Buffer.from(data));
    if (out) return rawSend(out);
  };
  ws.once('close', () => { closed = true; if (enc) enc.close(); });
  return ws;
}
