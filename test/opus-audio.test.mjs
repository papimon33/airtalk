/* Soniox 로 보내는 음성 Opus(Ogg) 압축 — 인코더·Ogg 페이지·소켓 감싸기 단위 시험 + 서버를 띄운 경로 시험(가짜 엔진, 무과금).
   실제 엔진 정확도·지연 비교는 2026-11-17 실측(vendors/soniox_audio.js 머리말). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import { OggOpusEncoder, oggCrc, wrapSonioxSocket } from '../server/vendors/soniox_audio.js';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until } from './helpers/boot.mjs';

const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');
const RATE = 24000;

// Ogg 바이트열 → 페이지 목록 { flags, granule, seq, packets[], crcOk }
function parseOgg(buf) {
  const pages = [];
  let o = 0;
  while (o < buf.length) {
    assert.equal(buf.toString('latin1', o, o + 4), 'OggS', `페이지 시작 표시(위치 ${o})`);
    const nseg = buf[o + 26];
    const lacing = [...buf.subarray(o + 27, o + 27 + nseg)];
    let p = o + 27 + nseg;
    const packets = [];
    let cur = [];
    for (const l of lacing) { cur.push(buf.subarray(p, p + l)); p += l; if (l < 255) { packets.push(Buffer.concat(cur)); cur = []; } }
    const page = Buffer.from(buf.subarray(o, p));
    const crc = page.readUInt32LE(22); page.writeUInt32LE(0, 22);
    pages.push({ flags: buf[o + 5], granule: Number(buf.readBigInt64LE(o + 6)), seq: buf.readUInt32LE(o + 18), packets, crcOk: oggCrc(page) === crc });
    o = p;
  }
  return pages;
}
const sine = (ms, amp = 0.3, hz = 440) => {
  const n = Math.round(RATE * ms / 1000), b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / RATE) * amp * 32767), i * 2);
  return b;
};
const rms = (b, from = 0) => { let s = 0, n = 0; for (let i = from * 2; i + 1 < b.length; i += 2) { const v = b.readInt16LE(i); s += v * v; n++; } return Math.sqrt(s / Math.max(1, n)); };

test('Opus: 머리 페이지 2개(OpusHead·OpusTags), 첫 페이지 BOS, CRC 정상', () => {
  const enc = new OggOpusEncoder(24000);
  const pages = parseOgg(enc.header());
  enc.close();
  assert.equal(pages.length, 2);
  assert.ok(pages.every((p) => p.crcOk), 'CRC');
  assert.equal(pages[0].flags & 2, 2, '첫 페이지는 스트림 시작(BOS)');
  const head = pages[0].packets[0];
  assert.equal(head.toString('latin1', 0, 8), 'OpusHead');
  assert.equal(head[9], 1, '모노');
  assert.equal(head.readUInt32LE(12), RATE);
  assert.equal(pages[1].packets[0].toString('latin1', 0, 8), 'OpusTags');
  assert.deepEqual(pages.map((p) => p.seq), [0, 1]);
});

test('Opus: 100ms 조각 → 페이지 1개·20ms 패킷 5개, granule 은 48kHz 기준으로 증가, 패킷은 해독 가능', () => {
  const enc = new OggOpusEncoder(24000);
  enc.header();
  const pages = parseOgg(enc.encode(sine(100)));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].packets.length, 5);
  assert.equal(pages[0].granule, 5 * 960);
  assert.ok(pages[0].crcOk);
  const dec = new OpusScript(RATE, 1);
  for (const pk of pages[0].packets) assert.equal(dec.decode(pk).length, 480 * 2, '20ms = 480표본');
  dec.delete(); enc.close();
});

test('Opus: 20ms 가 안 되는 나머지는 다음 조각과 합치고, flush 는 무음으로 채워 마저 보낸다', () => {
  const enc = new OggOpusEncoder(24000);
  enc.header();
  let pages = parseOgg(enc.encode(sine(30)));       // 30ms → 1패킷 + 10ms 남음
  assert.equal(pages[0].packets.length, 1);
  assert.equal(enc.encode(sine(5)), null, '5ms 만으로는 보낼 것 없음(나머지 15ms)');
  pages = parseOgg(enc.encode(sine(5)));             // 15 + 5 = 20ms → 1패킷
  assert.equal(pages[0].packets.length, 1);
  assert.equal(pages[0].granule, 2 * 960);
  enc.encode(sine(7));                               // 7ms 남음
  pages = parseOgg(enc.flush());
  assert.equal(pages[0].packets.length, 1, '남은 7ms 를 한 프레임으로');
  assert.equal(enc.flush(), null, '더 남은 것 없음');
  enc.close();
  assert.equal(enc.encode(sine(100)), null, '닫힌 뒤엔 보내지 않음');
});

test('Opus: 압축·해독 후 소리 크기가 원음과 비슷하다(24kbps)', () => {
  const enc = new OggOpusEncoder(24000);
  enc.header();
  const src = sine(1000);
  const pages = parseOgg(enc.encode(src));
  const dec = new OpusScript(RATE, 1);
  const out = Buffer.concat(pages.flatMap((p) => p.packets).map((pk) => Buffer.from(dec.decode(pk))));
  dec.delete(); enc.close();
  const ratio = rms(out, 2400) / rms(src, 2400); // 앞 0.1초(인코더 지연) 제외
  assert.ok(ratio > 0.7 && ratio < 1.3, `소리 크기 비율 ${ratio.toFixed(2)}`);
});

test('Opus: 소켓 감싸기 — config 를 auto 로 바꾸고 머리 페이지를 붙이며, PCM 은 압축, 종료 신호 전에 남은 소리를 보낸다', () => {
  const sent = [];
  const ws = Object.assign(new EventEmitter(), { send: (d) => sent.push(d) });
  wrapSonioxSocket(ws, { codec: 'opus', bitrate: 24000 });
  ws.send(JSON.stringify({ model: 'stt-rt-v6', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1, language_hints: ['ko'] }));
  const cfg = JSON.parse(sent[0]);
  assert.equal(cfg.audio_format, 'auto');
  assert.ok(!('sample_rate' in cfg) && !('num_channels' in cfg));
  assert.deepEqual(cfg.language_hints, ['ko'], '나머지 설정은 그대로');
  assert.equal(parseOgg(sent[1])[0].packets[0].toString('latin1', 0, 8), 'OpusHead');
  ws.send(sine(110));                                  // 5패킷 + 10ms 남음
  assert.equal(parseOgg(sent[2])[0].packets.length, 5);
  ws.send(JSON.stringify({ type: 'agent_text', text: '안녕' })); // 다른 글자 메시지는 그대로
  assert.equal(JSON.parse(sent[3]).type, 'agent_text');
  ws.send('');                                         // 종료 신호
  assert.equal(parseOgg(sent[4])[0].packets.length, 1, '남은 10ms 먼저');
  assert.equal(sent[5], '', '그다음 종료 신호');
  ws.emit('close');
  assert.equal(sent.length, 6);
});

test('Opus: SONIOX_AUDIO_CODEC=pcm 이면 소켓을 건드리지 않는다', () => {
  const send = () => {};
  const ws = Object.assign(new EventEmitter(), { send });
  assert.equal(wrapSonioxSocket(ws, { codec: 'pcm' }).send, send);
});

test('Opus: 서버 경로 — 실시간 번역 세션의 마이크 PCM 이 엔진에는 Ogg Opus 로 간다', { timeout: 30000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url, SONIOX_AUDIO_CODEC: 'opus' });
  t.after(async () => { await srv.stop(); await fake.close(); });
  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '압축', pipeline: 'soniox', preset: 'oneway' }) }).then((r) => r.json());
  const host = new WebSocket(`${srv.base.replace('http', 'ws')}/ws/host?session=${sess.id}&src=mic&pipeline=soniox&sxMode=one&sxTarget=ja&in=ko`, { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { host.once('open', res); host.once('error', rej); });
  t.after(() => { try { host.close(); } catch {} });
  const c = await fake.nextConnection();
  const cfg = await c.waitConfig;
  assert.equal(cfg.audio_format, 'auto');
  assert.ok(!('sample_rate' in cfg));
  for (let i = 0; i < 5; i++) host.send(sine(100));
  await until(() => c.audioMsgs.length >= 2, { timeout: 5000, desc: '압축 오디오 도착' });
  const all = Buffer.concat(c.audioMsgs);
  const pages = parseOgg(all);
  assert.equal(pages[0].packets[0].toString('latin1', 0, 8), 'OpusHead', '첫 오디오는 머리 페이지');
  assert.ok(pages.every((p) => p.crcOk));
  const packets = pages.slice(2).flatMap((p) => p.packets).length;
  assert.ok(packets >= 5, `압축 패킷 ${packets}개`);
  assert.ok(c.audioBytes < 5 * 4800 / 3, `원음 24KB 보다 훨씬 작게(${c.audioBytes}바이트)`);
});
