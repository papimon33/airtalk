/* 파이프라인 순수 로직 회귀 테스트 — pipeline_util.js (무과금·즉시 실행)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kstDay, isAckOnly, stripFillers, sanitizeTranslation, deskCtlAllowed, langScriptOk, polishLengthOk, langJudge,
  copiesContext, termsKept, addsNote, translationCut, termHintsFrom, trimScopedTerms, estimateContextTokens,
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
  assert.equal(polishLengthOk('가'.repeat(150), '가'.repeat(85)), false, '85자 → 150자: 앞 사람 말이 덧붙은 경우(BBC 인터뷰)');
  assert.equal(polishLengthOk('가'.repeat(110), '가'.repeat(85)), true, '자연스럽게 조금 늘어난 것은 허용');
  assert.equal(polishLengthOk('처음부터 다시 설명해 주시겠어요?', '처음부터요.'), true, '단답은 맥락으로 보완해도 허용');
});

test('copiesContext: 다듬기가 직전 대화 문장을 옮겨 붙이면 거른다', () => {
  // 2026-11-11 BBC 인터뷰(黃仁勳) 02:36 — 앞 카드 번역문이 다음 카드 다듬기 뒤에 붙었다
  const ctx = '하지만 그가 알고 있다고 가정하고, 이 스파이의 행위를 계속 이어가며 교류하고 있다면 그분은 더 이상 NVIDIA의 CEO를 맡아서는 안 됩니다.';
  const raw = '어쨌든 그의 사생활이니까요. 공공과 사생활을 분명히 구분해야 해요. 제 생각에는 이게 영향을 미치지 않을 거예요. 그가 NVIDIA 회사 전체에 대해 취한 전략의 상황에는요, 네.';
  const bad = '그건 그의 사생활이니까요. 공공과 사생활은 분명히 구분해야 합니다. 제 생각에는 이게 NVIDIA 전체 전략에 영향을 미치지 않을 거예요. 그가 알고 있다고 가정하고 이 스파이의 행위를 계속 이어가며 교류하고 있다면, 그분은 더 이상 NVIDIA의 CEO를 맡아서는 안 됩니다.';
  const good = '어쨌든 그의 사생활이니까요. 공과 사는 분명히 구분해야죠. 이번 일이 NVIDIA 전체 전략에 영향을 주진 않을 거라고 봐요.';
  assert.equal(copiesContext(bad, raw, ctx), true);
  assert.equal(copiesContext(good, raw, ctx), false);
  assert.equal(copiesContext('처음부터 다시 설명해 주시겠어요?', '처음부터요.', '이 시스템을 처음부터 설명해 주세요.'), false, '짧은 단답 보완은 허용');
  assert.equal(copiesContext(good, raw, ''), false);
});

test('translationCut: 엔진 번역이 중간에 끊긴 카드를 알아본다', () => {
  // 2026-11-11 지명 시험 — 엔진 원본 메시지에서 확정 번역이 '마닐라,'에서 멈췄다
  const src = '日本方面，东京、大阪、福冈、名古屋、札幌和冲绳那霸都是热门航线。东南亚方面，有越南的河内、胡志明市、岘港、泰国的曼谷、清迈、普吉岛、菲律宾的马尼拉、宿务、印度尼西亚的雅加达和巴厘岛、马来西亚的吉隆坡，还有新加坡、柬埔寨金边、老挝万象和缅甸仰光。';
  assert.equal(translationCut(src, '일본 측에서는 도쿄, 오사카, 후쿠오카, 나고야, 삿포로와 오키나와가 모두 인기 노선입니다. 동남아 측에서는 베트남 호나이, 호치민시, 덴마크 푸켓, 칭다이, 마닐라,'), true);
  assert.equal(translationCut('欧洲方面，有俄罗斯莫斯科和海参崴、英国伦敦、法国巴黎、德国法兰克福、意大利罗马、西班牙马德里、荷兰阿姆斯特丹、瑞士苏黎世、波兰华沙。', '유럽 측에는 러시아 모스크바, 모스크바, 페트르부르크, 레이마'), true, '쉼표 없이 끊겨도 분량으로');
  // 정상 번역은 건드리지 않는다(언어쌍별 분량 차이)
  assert.equal(translationCut('中亚和南亚方面，有蒙古乌兰巴托、哈萨克斯坦阿拉木图、乌兹别克斯坦塔什干、印度新德里和孟买，以及尼泊尔加德满都。', '중앙아시아와 남아시아에는 몽골 울란바토르, 카자흐스탄 알마티, 우즈베키스탄 타슈켄트, 인도 뉴델리와 뭄바이, 네팔 카트만두가 있습니다.'), false);
  assert.equal(translationCut('국제선 청사 출국장으로 가시면 됩니다. 어느 항공사를 이용하시나요?', '请前往国际航班出发厅。请问您乘坐哪家航空公司？'), false, '한→중은 글자 수가 줄어도 정상');
  assert.equal(translationCut('Passengers can now check in with face recognition and drop their bags by themselves.', '이제 승객들은 얼굴 인식으로 체크인하고 짐도 직접 부칠 수 있습니다.'), false, '영→한');
  assert.equal(translationCut('你好。', '안녕하세요,'), false, '짧은 발화는 따지지 않음');
});

test('trimScopedTerms: 한도를 넘으면 언어 지정 용어를 목록 뒤쪽부터 먼저 빼고 전체 언어 용어는 남긴다', () => {
  // 전체 언어 용어(항공사) 2개 + 중국어 지정 지명 3개(목록 번호 5·6·7)
  const ctx = {
    terms: ['대한항공', '大韩航空', '西安', '시안', '郑州', '정저우', '银川', '인촨'],
    translation_terms: [{ source: '大韩航空', target: '대한항공' }, { source: '西安', target: '시안' }, { source: '郑州', target: '정저우' }, { source: '银川', target: '인촨' }],
  };
  const termMeta = [null, null, 5, 5, 6, 6, 7, 7];
  const pairMeta = [null, 5, 6, 7];
  const full = JSON.stringify(ctx).length;
  const limit = full - 30; // 지명 하나(인촨)만 빼면 들어오는 한도
  const n = trimScopedTerms(ctx, pairMeta, termMeta, limit);
  assert.equal(n, 3, '마지막 지명(银川·인촨·번역쌍)만 뺐다');
  assert.ok(JSON.stringify(ctx).length <= limit);
  assert.ok(ctx.terms.includes('대한항공') && ctx.terms.includes('西安'), '항공사·앞쪽 지명은 남음');
  assert.ok(!ctx.terms.includes('银川') && !ctx.translation_terms.some((p) => p.source === '银川'));
  // 한도 안이면 그대로
  const c2 = { terms: ['a'], translation_terms: [{ source: 'a', target: 'b' }] };
  assert.equal(trimScopedTerms(c2, [3], [3], 9500), 0);
  // 언어 지정 용어만으로 모자라면 그것만 다 빼고 나머지는 기존 방식(호출하는 쪽)에 맡긴다
  const c3 = { terms: ['대한항공', '西安'], translation_terms: [{ source: '大韩航空', target: '대한항공' }, { source: '西安', target: '시안' }] };
  assert.equal(trimScopedTerms(c3, [null, 4], [null, 4], 10), 2);
  assert.deepEqual(c3, { terms: ['대한항공'], translation_terms: [{ source: '大韩航空', target: '대한항공' }] });
});

test('estimateContextTokens: Soniox 가 세는 방식(용어 문자열 + 항목당 비용)으로 토큰을 추정한다', () => {
  // 기본 10 + 내용(한중일·한글 글자당 1, 영숫자 4글자당 1) + 인식어 1개당 1 / 번역쌍 1개당 3.5
  assert.equal(estimateContextTokens({ terms: ['김포공항'] }), 10 + 4 + 1);
  assert.equal(estimateContextTokens({ terms: ['ゲート'] }), 10 + 3 + 1);
  assert.equal(estimateContextTokens({ terms: ['ICAO', 'A-CDM'] }), 10 + (1 + 1) + (1 + 1 + 1 + 1), 'A-CDM = A·-·CDM');
  assert.equal(estimateContextTokens({ translation_terms: [{ source: '金浦机场', target: '김포공항' }] }), Math.ceil(10 + 4 + 4 + 3.5));
  // 2026-11-11 실측(거부 메시지의 정확한 토큰 수)과 2% 안
  const ko = Array.from({ length: 2500 }, (_, i) => '가나다'.slice(0, 2 + (i % 2)) + (i % 3 ? '' : '라')); // 2~4자
  const chars = ko.reduce((a, s) => a + s.length, 0);
  assert.equal(estimateContextTokens({ terms: ko }), 10 + chars + 2500);
  const actualPerTerm = 9996 / (7505 + 2500); // 실측: 한글 인식어 2,500개(7,505자) = 9,996토큰
  assert.ok(Math.abs(actualPerTerm - 1) < 0.02);
});

test('termHintsFrom: 원문에 나온 등록 용어만 목표 언어 표기로 넘긴다', () => {
  const entries = [
    { names: { ko: '김포', zh: '金浦', en: 'Gimpo' } },
    { names: { ko: '중국민용항공국', zh: '民航局' } },
    { names: { ko: '하노이', zh: '河内', en: 'Hanoi' } },
    { names: { ko: '세부' } },
  ];
  assert.deepEqual(termHintsFrom(entries, '从金浦出发，民航局表示……', 'ko'), ['金浦→김포', '民航局→중국민용항공국']);
  assert.deepEqual(termHintsFrom(entries, '김포에서 하노이로', 'zh'), ['김포→金浦', '하노이→河内']);
  assert.deepEqual(termHintsFrom(entries, '세부 사항', 'zh'), [], '목표 언어 표기가 없으면 넘기지 않음');
});

test('addsNote: 다듬기가 기계 번역에 없던 괄호(교정 메모)를 덧붙이면 거른다', () => {
  // 2026-11-11 지명 시험 — 모델의 혼잣말이 번역문에 섞여 나왔다
  assert.equal(addsNote('시카고, 와이키키(탄샹산은 의역이므로 고쳐야 하지만 고유명사와 숫자 유지), 괌', '시카고, 탄샹산이 있고, 괌'), true);
  assert.equal(addsNote('SAF(지속가능항공유) 혼합 비율을 높입니다.', 'SAF(지속가능항공유)의 혼합 비율을 높입니다.'), false, '기계 번역에도 있던 괄호는 허용');
  assert.equal(addsNote('탑승구는 3층에 있습니다.', '탑승구 3층에 있습니다.'), false);
});

test('termsKept: 엔진이 용어집대로 옮긴 용어를 다듬기가 지우면 거른다', () => {
  // 2026-11-11 한→중 항공 회의: 기계 번역 '十五五规划' → 다듬기 '十四五'
  const terms = ['十五五规划', '国庆黄金周', '韩国机场公社', '低空经济'];
  assert.equal(termsKept('最后，在中国的“十四五”规划期间……', '最后，中国在十五五规划期间……', terms), false);
  assert.equal(termsKept('最后，在中国十五五规划期间……', '最后，中国在十五五规划期间……', terms), true);
  assert.equal(termsKept('今年国庆黄金周', '今年国晟假期', terms), true, '기계 번역에 없던 용어를 다듬기가 넣는 것은 허용');
  assert.equal(termsKept('올해 황금연휴 동안', '올해 국경절 황금연휴 기간에', ['국경절 황금연휴']), false);
  assert.equal(termsKept('올해 국경절황금연휴 동안', '올해 국경절 황금연휴 기간에', ['국경절 황금연휴']), true, '띄어쓰기 차이는 무시');
});

test('langScriptOk: 다듬기가 원문 언어(한국어)로 돌아가거나 중국어를 번체로 쓰면 거른다', () => {
  // 2026-10-28 발표 테스트: 중국어 칸에 한국어 다듬기, 번체자 다듬기가 섞여 나왔다
  assert.equal(langScriptOk('2025년 12월 11일에 BIM 센터를 공식 개소했습니다.', '2025年12月11日，BIM中心正式开放。', 'zh'), false);
  assert.equal(langScriptOk('今天的特別報告內容是關於 AI/BIM 中心運營方案的事宜。', '今天的特别报告内容是关于AI/BIM中心运营方案。', 'zh'), false);
  assert.equal(langScriptOk('今天的特别报告是关于AI/BIM中心运营方案的。', '今天的特别报告内容是关于AI/BIM中心运营方案。', 'zh'), true);
  assert.equal(langScriptOk('本日の報告はAI・BIMセンターの運営についてです。', '今日の報告はAI・BIMセンター運営方案です。', 'ja'), true, '일본어 한자는 번체 검사 대상 아님');
  assert.equal(langScriptOk('안내데스크는 2층에 있습니다.', '안내 데스크는 2층입니다.', 'ko'), true);
  assert.equal(langScriptOk('The 김포 terminal', 'The 김포 terminal opens', 'en'), true, '기계 번역에도 있던 한글은 허용');
  // 2026-11-11 중→한 테스트: 한국어 다듬기에 원문 중국어 글자가 섞여 나왔다
  assert.equal(langScriptOk('환불은 어디서办理하나요?', '환불은 어디서 받나요?', 'ko'), false);
  assert.equal(langScriptOk('すみません, where is gate 3?', 'Excuse me, where is gate 3?', 'en'), false, '가나가 샌 영어 다듬기');
  assert.equal(langScriptOk('국토교통부(國土交通部) 발표입니다.', '국토교통부(國土交通部)가 발표했습니다.', 'ko'), true, '기계 번역에도 있던 한자는 허용');
  assert.equal(langScriptOk('登机口在3楼。', '登机口在三楼。', 'zh'), true);
  assert.equal(langScriptOk('搭乗口は3階です。', '搭乗口は3階にあります。', 'ja'), true);
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
