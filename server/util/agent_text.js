/* 에이전트 텍스트 입력(Soniox stt-rt-v6, enable_agent_text_input) — 이 기기 스피커로 나가는 TTS 문장을
   재생 속도에 맞춰 엔진에 알려 준다. 엔진은 받은 글자를 그 순간의 음성 위치에 놓고, 그 소리가 마이크로
   다시 들어오면 사용자 말로 적지 않는다(2026-11 실험: 크게 샌 TTS 가 사용자 말로 잡힌 비율 99% → 0,
   사용자 말 인식은 그대로). 기기 에코 제거·서버 에코 필터는 그대로 두고 그 뒤에 남는 것을 거른다.
   · 재생 시각: 호스트는 받은 오디오를 순서대로 이어서 재생하므로, 서버가 보낸 오디오 길이로 추정한다.
   · 글자 시각: 문장 오디오에 고르게 나눈다. 합성 중엔 받은 길이와 글자당 msPerChar 로 잡은 길이 중 큰 값.
   · 재생 leadMs 전에 보낸다(문서 권장 0.5~1초). 문장이 끝나면 end_of_segment. */
const BYTES_PER_MS = 48; // 24kHz PCM16 모노

export function agentTextFeed(send, opts = {}) {
  const lead = opts.leadMs ?? 700;
  const net = opts.netMs ?? 150;        // 서버 → 기기 재생 시작까지
  const msPerChar = opts.msPerChar ?? 100; // 실측 한국어 약 120·일본어 약 150 — 조금 짧게 잡아 늦지 않게
  const now = opts.now || Date.now;
  const segs = [];  // 재생 순서대로 { chars, sent, start, dur, done }
  let cursor = 0;   // 기기의 재생 줄이 비는 시각(추정)
  let timer = null;
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
  const tick = () => {
    const t = now();
    while (segs.length) {
      const s = segs[0];
      if (s.start == null) {
        if (s.done) { segs.shift(); continue; } // 오디오 없이 끝남(합성 실패) — 보낼 것 없음
        break;
      }
      const n = s.chars.length;
      const total = s.done ? s.dur : Math.max(s.dur, n * msPerChar);
      let k = s.sent;
      while (k < n && s.start + (total * k) / n <= t + lead) k++;
      const last = s.done && k === n;
      if (k > s.sent || last) {
        send({ type: 'agent_text', text: s.chars.slice(s.sent, k).join(''), ...(last ? { end_of_segment: true } : {}) });
        s.sent = k;
      }
      if (!last) break;
      segs.shift();
    }
    if (!segs.length) stopTimer();
  };
  return {
    // 이 기기에서 재생할 문장 — 오디오가 오기 전에 부른다
    begin(text) { const s = { chars: [...String(text || '')], sent: 0, start: null, dur: 0, done: false }; segs.push(s); return s; },
    // 그 문장의 오디오 조각을 기기로 보냈다
    audio(s, bytes) {
      if (s.start == null) s.start = Math.max(now() + net, cursor);
      s.dur += bytes / BYTES_PER_MS;
      cursor = Math.max(cursor, s.start + s.dur);
      if (!timer) timer = setInterval(tick, opts.tickMs ?? 50);
      tick();
    },
    // 합성이 끝났다(실패 포함)
    end(s) { s.done = true; tick(); },
    // 재생을 껐다·엔진이 바뀌었다 — 보내던 문장은 끊겼다고 알리고 나머지는 버린다
    cancel() {
      if (segs.length && segs[0].sent > 0) send({ type: 'agent_text', text: '', end_of_segment: true });
      segs.length = 0;
      cursor = 0;
      stopTimer();
    },
    pending: () => segs.length,
    tick,
  };
}
