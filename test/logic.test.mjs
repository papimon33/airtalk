/* 파이프라인 순수 로직 회귀 테스트 — pipeline_util.js (무과금·즉시 실행)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kstDay, isAckOnly, stripFillers, sanitizeTranslation, deskCtlAllowed, langScriptOk, polishLengthOk, langJudge,
} from '../server/util/pipeline_util.js';
import { agentTextFeed } from '../server/util/agent_text.js';

test('isAckOnly: 단독 응답어만 참(문장은 거짓)', () => {
  assert.equal(isAckOnly('네.'), true);
  assert.equal(isAckOnly('Yes'), true);
  assert.equal(isAckOnly('はい。'), true);
  assert.equal(isAckOnly('好的'), true);
  assert.equal(isAckOnly('네, 이쪽으로 오세요'), false);
  assert.equal(isAckOnly(''), false);
});

/* ── 간투사 제거 ── */
test('stripFillers: 문장 속 간투사(음/어/uh)를 제거하고 공백·구두점을 정리한다', () => {
  assert.equal(stripFillers('음 그러니까 어 화장실이요'), '그러니까 화장실이요');
  assert.equal(stripFillers('uh where is um the gate?'), 'Where is the gate?');
});

test('stripFillers: 발화 전체가 잡음이면 빈 문자열(카드 드롭), 단독 응답어는 보존', () => {
  assert.equal(stripFillers('あー'), '');
  assert.equal(stripFillers('yeah'), 'Yeah'); // 소프트 간투사 — 발화 전체면 실제 대답이므로 보존(첫 글자 복원 규칙 적용)
});

test('stripFillers: 간투사가 없는 문장은 그대로 둔다(한글 단어 속 음/어 오검출 금지)', () => {
  assert.equal(stripFillers('어제 음악회에 갔습니다'), '어제 음악회에 갔습니다');
});

/* ── GPT 번역 출력 정제 ── */
test('sanitizeTranslation: 코드블록·머리말·화살표·메타 주석을 벗겨낸다', () => {
  assert.equal(sanitizeTranslation('```\n안녕하세요\n```'), '안녕하세요');
  assert.equal(sanitizeTranslation('원문 → 번역된 문장'), '번역된 문장');
  assert.equal(sanitizeTranslation('번역하면 다음과 같습니다: 안녕하세요'), '안녕하세요');
  assert.equal(sanitizeTranslation('안녕하세요 (자연스럽게 번역)'), '안녕하세요');
  assert.equal(sanitizeTranslation(''), '');
});

/* ── 데스크 제어 남용 가드(C2 회귀): 소켓 20/분·세션 40/분·start/end 0.8초 간격 ── */
test('deskCtlAllowed: start/end 는 세션당 0.8초 간격, 마이크(micOnly)는 간격 제한이 없다', () => {
  const ws = {}, room = {};
  const t0 = 1_000_000;
  assert.equal(deskCtlAllowed(ws, room, false, t0), true);
  assert.equal(deskCtlAllowed(ws, room, false, t0 + 100), false); // 0.8초 미만 재시도 → 거부
  assert.equal(deskCtlAllowed(ws, room, true, t0 + 100), true);   // desk-mic 은 간격 제한 제외
  assert.equal(deskCtlAllowed(ws, room, false, t0 + 900), true);  // 간격 경과 → 허용
});

test('deskCtlAllowed: 소켓당 분당 20회 초과를 차단하고 60초 후 윈도가 리셋된다', () => {
  const ws = {};
  const t0 = 1_000_000;
  for (let i = 0; i < 20; i++) assert.equal(deskCtlAllowed(ws, null, true, t0 + i), true, `i=${i}`);
  assert.equal(deskCtlAllowed(ws, null, true, t0 + 30), false); // 21번째 → 거부
  assert.equal(deskCtlAllowed(ws, null, true, t0 + 61_000), true); // 윈도 리셋
});

test('deskCtlAllowed: 세션(room)당 분당 40회 상한 — 소켓을 갈아타도 막힌다', () => {
  const room = {};
  const t0 = 1_000_000;
  let allowed = 0;
  for (let i = 0; i < 60; i++) {
    if (deskCtlAllowed({}, room, true, t0 + i)) allowed++; // 매번 새 소켓(공격 시나리오)
  }
  assert.equal(allowed, 40);
});

/* ── KST 일자 버킷 ── */
test('kstDay: UTC 자정 직전은 KST 로는 다음 날로 버킷된다', () => {
  // 2026-07-15T23:00:00Z = KST 2026-07-16 08:00
  assert.equal(kstDay(Date.parse('2026-07-15T23:00:00Z')), '2026-07-16');
  assert.equal(kstDay(Date.parse('2026-07-15T10:00:00Z')), '2026-07-15');
});

test('langJudge: 카드 끝에 붙은 다른 언어 단어 하나로 카드 언어가 뒤집히지 않는다', () => {
  const j = langJudge();
  const tr = (text, source_language) => ({ translation_status: 'translation', is_final: true, text, source_language });
  j.begin();
  j.token(tr('設計から運用まで約1年半かかりました。', 'ko'));
  assert.equal(j.pick(''), 'ko');
  j.token(tr('정말.', 'ja')); // 다음 사람의 첫 단어(大変)가 이 카드에 섞여 온 경우
  assert.equal(j.pick('ko'), 'ko', '글자 수가 많은 쪽을 따른다');
  j.reset();
  j.token({ translation_status: 'original', is_final: true, text: 'BHS', language: 'en' });
  assert.equal(j.pick(''), 'en');
  j.token(tr('수하물 처리 시스템입니다.', 'ja'));
  assert.equal(j.pick('en'), 'ja', '번역 방향은 원문 토큰보다 우선한다');
});

test('polishLengthOk: 긴 번역의 뒷부분이 사라진 다듬기는 거른다', () => {
  const long = '가'.repeat(501);
  assert.equal(polishLengthOk('가'.repeat(192), long), false, '501자 → 192자(실제 v6 발표 테스트에서 나온 유실)');
  assert.equal(polishLengthOk('가'.repeat(450), long), true, '자연스럽게 조금 줄어든 것은 허용');
  assert.equal(polishLengthOk('가'.repeat(18), '가'.repeat(31)), true, '짧은 문장은 많이 줄어도 허용');
  assert.equal(polishLengthOk('가'.repeat(200), '가'.repeat(50)), false, '해설이 섞여 크게 늘어난 경우');
});

test('langScriptOk: 다듬기가 원문 언어(한국어)로 돌아가거나 중국어를 번체로 쓰면 거른다', () => {
  // 2026-10-28 발표 테스트: 중국어 칸에 한국어 다듬기, 번체자 다듬기가 섞여 나왔다
  assert.equal(langScriptOk('2025년 12월 11일에 BIM 센터를 공식 개소했습니다.', '2025年12月11日，BIM中心正式开放。', 'zh'), false);
  assert.equal(langScriptOk('今天的特別報告內容是關於 AI/BIM 中心運營方案的事宜。', '今天的特别报告内容是关于AI/BIM中心运营方案。', 'zh'), false);
  assert.equal(langScriptOk('今天的特别报告是关于AI/BIM中心运营方案的。', '今天的特别报告内容是关于AI/BIM中心运营方案。', 'zh'), true);
  assert.equal(langScriptOk('本日の報告はAI・BIMセンターの運営についてです。', '今日の報告はAI・BIMセンター運営方案です。', 'ja'), true, '일본어 한자는 번체 검사 대상 아님');
  assert.equal(langScriptOk('안내데스크는 2층에 있습니다.', '안내 데스크는 2층입니다.', 'ko'), true);
  assert.equal(langScriptOk('The 김포 terminal', 'The 김포 terminal opens', 'en'), true, '기계 번역에도 있던 한글은 허용');
});

test('agentTextFeed: TTS 글자를 재생 0.7초 전에 맞춰 보내고, 문장 끝에 end_of_segment', () => {
  let t = 1000;
  const sent = [];
  const f = agentTextFeed((m) => sent.push(m), { now: () => t, tickMs: 1e9, netMs: 100, leadMs: 700, msPerChar: 100 });
  const s = f.begin('가나다라마바사아자차'); // 10자
  assert.equal(sent.length, 0, '오디오가 나가기 전에는 보내지 않는다');
  f.audio(s, 48 * 2000); // 2초 분량 — 재생은 1100ms 에 시작
  // 1000 + 700 = 1700 까지 재생될 글자: 시작 1100, 글자당 200ms(합성 중엔 max(2000, 1000)) → 0·1·2번째(1100·1300·1500), 3번째는 1700
  assert.deepEqual(sent.map((m) => m.text), ['가나다라']);
  t = 1800; f.tick(); // 2500 까지: 1100·1300·…·2500 → 8자
  assert.equal(sent.map((m) => m.text).join(''), '가나다라마바사아');
  assert.ok(!sent.some((m) => m.end_of_segment), '합성이 끝나기 전에는 문장을 닫지 않는다');
  f.end(s); t = 4000; f.tick();
  assert.equal(sent.map((m) => m.text).join(''), '가나다라마바사아자차');
  assert.equal(sent[sent.length - 1].end_of_segment, true);
  assert.equal(f.pending(), 0);
});

test('agentTextFeed: 다음 문장은 앞 문장 재생이 끝난 뒤로 잡는다', () => {
  let t = 0;
  const sent = [];
  const f = agentTextFeed((m) => sent.push(m), { now: () => t, tickMs: 1e9, netMs: 0, leadMs: 500 });
  const a = f.begin('하나'); f.audio(a, 48 * 3000); f.end(a); // 0~3000 재생
  const b = f.begin('둘'); f.audio(b, 48 * 1000); f.end(b);   // 3000~4000 재생
  t = 1000; f.tick();
  assert.ok(!sent.some((m) => m.text.includes('둘')), '앞 문장 재생 중에는 다음 문장을 보내지 않는다');
  t = 2600; f.tick();
  assert.ok(sent.some((m) => m.text.includes('둘')), '재생 0.5초 전에는 보낸다');
  assert.equal(sent.filter((m) => m.end_of_segment).length, 2);
});

test('agentTextFeed: 재생을 끄면 보내던 문장을 끊었다고 알리고 나머지는 버린다', () => {
  let t = 0;
  const sent = [];
  const f = agentTextFeed((m) => sent.push(m), { now: () => t, tickMs: 1e9, netMs: 0, leadMs: 0 });
  const a = f.begin('가나다라'); f.audio(a, 48 * 4000);
  t = 1500; f.tick();
  f.begin('다음 문장');
  f.cancel();
  assert.deepEqual(sent[sent.length - 1], { type: 'agent_text', text: '', end_of_segment: true });
  t = 9000; f.tick();
  assert.ok(!sent.some((m) => m.text.includes('다음')));
  assert.equal(f.pending(), 0);
});
