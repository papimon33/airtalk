# AirTalk

공항 현장을 위한 실시간 음성 번역 웹 서비스입니다. 말하는 즉시 원문과 번역문을 화면에 띄우고, 번역 음성(TTS)으로 들려줍니다.
참가자는 QR 코드로 자기 휴대폰에서 같은 대화를 자기 언어로 봅니다. 한국공항공사의 안내데스크·견학·회의 통역을 위해 만들었습니다.

- **접속 주소: https://airtalk.kr**
- 로그인이 필요합니다. 계정은 관리자가 관리자 페이지에서 만듭니다. QR 뷰어(참가자 화면)는 로그인 없이 열립니다.
- 출품: 2026 공공 AI 대전환 챌린지 세션1(자유주제)

## 주요 기능

| 기능 | 내용 |
|---|---|
| **실시간 번역** | 한 방향 번역입니다. 마이크 또는 시스템 오디오(PC에서 나오는 화상회의·영상 소리)를 듣고 원문과 번역문을 실시간으로 보여 줍니다. 60개 언어를 지원합니다. |
| **양방향 통역** | 두 언어가 오가는 대화를 말한 언어에 맞춰 상대 언어로 번역합니다. 마이크 2대(2채널)를 쓰면 사람별로 나눠 듣고, '마이크 + 시스템 오디오'로 화상회의도 통역합니다. |
| **안내데스크** | 안내데스크 상시 운영용입니다. 손님이 태블릿에서 12개 언어 중 하나를 누르면(그 밖의 언어는 자동 감지) 개인정보 고지·동의 뒤 통역이 시작됩니다. 안내원 말은 손님 언어로, 손님 말은 한국어로 보여 줍니다. 말이 없으면 자동으로 대기 화면으로 돌아갑니다. |
| **QR 뷰어** | 세션 화면의 링크 공유를 누르면 QR 코드와 링크가 나옵니다. 참가자는 앱 설치 없이 휴대폰 브라우저에서 자기 언어로 보고 들을 수 있습니다(`/j/<참여 코드>`, 안내데스크 태블릿은 `/desk/<코드>`). |
| **번역 음성(TTS)** | 확정된 번역문을 음성으로 읽어 줍니다. 이 기기와 뷰어에서 각각 켜고 끕니다. |
| **용어 설정** | 공항·항공 고유명사와 지정 번역(예: 탑승구 → gate)을 등록하면 인식과 번역에 반영합니다. |
| **대화 기록** | 세션별 대화가 자동 저장됩니다. 내보내기로 텍스트 파일을 받습니다. |
| **관리자** | 사용량(서비스별 청구액)·로그(응대·대화 전문)·계정 관리(권한: TTS·안내데스크)·용어 설정·시스템·보안(관리자 2단계 인증·전체 백업). |
| **앱** | Windows·macOS 데스크톱 앱(화상회의 위에 자막을 겹치는 오버레이 창), Android 앱(자동 증폭 없는 네이티브 마이크). 모두 같은 웹 화면을 씁니다. 로그인 뒤 이름 메뉴 > 앱 설치에서 내려받습니다. |

로그인은 계정당 PC 1대와 휴대폰 1대까지 동시에 쓸 수 있습니다.

## 작동 방법

1. https://airtalk.kr 에 접속해 로그인합니다.
2. 새 세션 버튼을 누르고 모드(실시간 번역·양방향 통역·안내데스크), 언어, 이름을 정합니다. 안내데스크는 안내데스크 권한이 있는 계정에만 보입니다.
3. 세션 화면 아래쪽에서 입력 소스(마이크·시스템 오디오)와 언어를 고르고 시작 버튼을 누릅니다. 말하면 원문과 번역문이 카드로 쌓입니다.
4. 링크 공유를 누르면 QR 코드가 나옵니다. 참가자가 휴대폰으로 찍으면 같은 대화를 자기 언어로 봅니다.
5. 안내데스크는 PC에서 세션을 열어 두고, 손님용 태블릿에서 그 세션의 링크(`/desk/<코드>`)를 엽니다. 손님이 언어를 누르면 통역이 시작됩니다.

## 실행 방법(직접 설치)

### 준비

- **Node.js 22 LTS(22.12 이상)**. 20.19 이상이면 앱은 실행되지만 `npm test` 는 Node 22가 필요합니다.
- API 키: OpenAI(필수), Soniox(필수), Cartesia(선택, 번역 음성). 각 회사에서 발급받습니다.
- MongoDB(선택). 없으면 `data/` 폴더의 JSON 파일에 저장합니다.

### 설치·실행

```bash
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

`.env` 에 값을 넣습니다(나머지 항목은 `.env.example` 설명 참고).

| 변수 | 필수 | 설명 |
|---|---|---|
| `OPENAI_API_KEY` | 필수 | 번역 다듬기·용어 검증(GPT). 없으면 서버가 시작되지 않습니다. |
| `SONIOX_API_KEY` | 필수 | 실시간 음성 인식·번역(Soniox). 없으면 실시간 번역·안내데스크를 시작할 수 없습니다. |
| `CARTESIA_API_KEY` | 선택 | 번역 음성(TTS). 없으면 음성 출력만 꺼집니다. |
| `ADMIN_ID` / `ADMIN_PASSWORD` | 권장 | 관리자 계정. 비우면 admin / admin 입니다(로컬 전용). |
| `MONGODB_URI` | 선택 | MongoDB 연결 문자열. 비우면 파일 저장입니다. |

```bash
npm start                   # 화면 빌드(vite build) 후 서버 시작
```

- 브라우저에서 **http://localhost:3000** 을 열고 관리자 계정으로 로그인합니다.
- 마이크는 브라우저가 https 또는 localhost 에서만 허용합니다. 로컬에서는 localhost 주소로 여세요.
- 로컬에서 만든 QR은 이 PC의 내부 IP 주소를 가리켜, 같은 와이파이의 휴대폰에서 뷰어를 열 수 있습니다.
- 코드를 고친 뒤에는 다시 시작합니다. 화면만 빌드: `npm run build`, 서버만 시작: `npm run serve`.
- 운영 모드(`NODE_ENV=production`)에서는 `AUTH_SECRET` 이 없거나 관리자 비밀번호가 기본값이면 서버가 시작되지 않습니다.
- ⚠ OpenAI·Soniox·Cartesia 호출은 쓸 때마다 요금이 발생합니다. 시험 세션은 끝나면 삭제하세요.

### API 키 없이 시험하기

```bash
npm test
```

- 실제 번역 서비스 대신 가짜 Soniox·Cartesia 서버를 띄워 시험합니다. API 키가 필요 없고 요금이 발생하지 않습니다(서버 테스트 70여 건, 약 30초).
- 실시간 번역 흐름, 안내데스크 응대, 양방향 화자 전환, 로그인 자리·권한, 저장소 손상 복구, 보안(2단계 인증·저장 암호화)을 확인합니다.
- 화면 테스트: `npm run build && npm run test:e2e` (Playwright, 이 PC에 설치된 Chrome 사용, 역시 무과금).
- Windows 에서는 '정상 종료 시 로그인 유지' 시험 1건을 건너뜁니다. Windows 는 정상 종료 신호(SIGTERM)를 보낼 수 없습니다.

## 모델 구성과 교체 위치

음성 인식·번역, 번역 다듬기, 음성 합성을 각각 다른 회사의 모델이 맡습니다. 모델 이름은 `server/config.js` 한곳에 있고, 회사별 호출 코드는 `server/vendors/` 에 나뉘어 있습니다.

| 역할 | 지금 쓰는 모델 | 설정값(`server/config.js`) | 호출 코드 |
|---|---|---|---|
| 실시간 음성 인식 + 번역 | Soniox `stt-rt-v6` | `SONIOX_MODEL` | `server/vendors/soniox.js`(접속·용어 반영), `server/pipelines/soniox.js`(실시간 번역·양방향), `server/pipelines/desk.js`(안내데스크) |
| 번역 감수(다듬기)·용어 검증 | OpenAI `gpt-5.4-mini` | `REFINE_MODEL` | `server/vendors/openai.js`(지시문), `server/vendors/refine_notes.js`(언어쌍별 표기 규칙), `server/routes/terms.js` |
| 번역 음성(TTS) | Cartesia `sonic-3.5` | `CARTESIA_MODEL` | `server/vendors/cartesia.js` |
| 단일 언어 통역(이전 방식) | OpenAI `gpt-realtime-translate` | `TRANSLATE_MODEL` | `server/pipelines/translate.js` (새 세션 화면에서는 고를 수 없음) |

- **같은 회사의 다른 모델로 바꿀 때:** `server/config.js` 의 값만 고칩니다(예: `REFINE_MODEL` 을 `gpt-5-mini` 로). GPT-5 계열은 추론 강도를 자동으로 맞춥니다(`server/vendors/openai.js` `reasoningEffort`).
- **다른 회사 서비스로 바꿀 때:** `server/vendors/` 에 같은 역할의 모듈을 추가하고 `server/pipelines/` 에서 부르는 곳을 바꿉니다. 화면(`client/`)이 받는 WebSocket 메시지 형식은 그대로라 화면은 고치지 않아도 됩니다.
- 시험용 가짜 서버로 붙일 때는 `SONIOX_WS_URL`·`CARTESIA_TTS_WS_URL` 환경변수로 접속 주소를 바꿉니다(`test/helpers/` 참고).

## 데이터·보안

- 저장소: `MONGODB_URI` 가 있으면 MongoDB, 없으면 `data/*.json` 파일. `DATA_KEY` 를 정하면 파일을 AES-256-GCM 으로 암호화해 저장합니다.
- 관리자 2단계 인증(TOTP), 로그인 시도 제한, 보안 헤더, 교차 출처 요청 차단을 적용했습니다. 자세한 내용은 `docs/SECURITY_GUIDE.md`.
- 저장소의 평가 자료(`tools/eval/`의 대본·시나리오·표본)는 직접 만든 가상 대화입니다. 실제 이용자 대화나 운영 데이터는 들어 있지 않습니다.
- API 키·비밀번호는 저장소에 넣지 않습니다. `.env` 는 `.gitignore` 에 들어 있습니다.

## 외부 서비스·오픈소스 라이선스

- **외부 유료 API(재배포 대상 아님):** OpenAI, Soniox, Cartesia. 저장소에는 호출 코드만 있고, 실행하는 쪽이 각 회사 약관에 따라 키를 발급받아야 합니다.
- **실행 앱에 들어가는 npm 패키지:** MIT·ISC·Apache-2.0·BSD 계열만 씁니다(React, MUI, Express, ws, mongodb, recharts, qrcode, lucide-react 등).
- **개발·빌드 도구에만 쓰는 패키지:** lightningcss(MPL-2.0, 화면 빌드), @breezystack/lamejs(LGPL-3.0, 평가용 음성 파일 생성 `tools/eval`), sharp·libvips(LGPL-3.0, 데스크톱 앱 아이콘 생성). 실행 앱과 배포 파일에는 들어가지 않습니다.
- **글꼴:** Pretendard·Noto Sans KR/SC·Nunito(SIL OFL 1.1). CDN에서 불러오며 저장소에는 없습니다.
- **데스크톱 앱 설치본:** Electron(MIT)을 포함합니다. Chromium 등 내장 구성요소의 라이선스는 설치본의 `LICENSES.chromium.html` 에 있습니다.
- `tools/tts_samples/*.mp3` 는 Cartesia로 합성한 시험용 음성 견본입니다.

## 로그(데이터) 구조

모든 분석 데이터는 **세션의 대화 항목(item) 하나에 함께** 쌓입니다(별도 로그 파일 없음). 안내데스크는 응대가 끝날 때 items 가 `deskLog` 항목으로 보관됩니다.

```jsonc
// session.items[] / session.deskLog[].items[]
{
  "id": "mr…",
  "side": "right",            // right=호스트(마이크) / left=상대(손님 채널)·시스템
  "lang": "ja",               // 발화 원문 언어
  "source": "トイレはどこですか。",       // 원문(음성 인식)
  "texts": { "ko": "화장실은 어디예요?" }, // 번역 { 언어코드: 문장 }
  "toks": [["トイ", 0.98], ["レ", 0.95]], // 원문 토큰별 신뢰도(최대 120개)
  "tm": {                     // 지연 분석용 시각(epoch ms, 저장 전용)
    "s": 1789000000000,       //  첫 토큰(말 시작)
    "e": 1789000003000,       //  말 끝 판정
    "c": 1789000003200,       //  카드 확정
    "tq": 1789000003300,      //  TTS 합성 요청
    "ta": 1789000003700       //  TTS 첫 소리
  }
}

// session.deskLog[]  (안내데스크 응대 1건)
{ "startedAt": 0, "endedAt": 0, "lang": "en", "interrupted": false,
  "items": [], "stats": { "staff": 7, "guest": 5, "crossDrops": 0 } }
```

| 분석 | 계산 | 의미 |
|---|---|---|
| 확정 지연 | `tm.c − tm.e` | 말이 끝나고 카드가 뜨기까지 |
| 체감 총지연 | `tm.ta − tm.e` | 말 끝 → 번역 음성 시작 |
| 응대 응답 지연 | 손님 item `tm.e` → 다음 안내원 item `tm.s` | 안내데스크 서비스 지표 |
| 언어 분포·응대량 | `deskLog.lang` · 건수/시간 | 관리자 > 로그에서 응대 로그를 JSON으로 내려받아 집계 |
| 누화율 | `deskLog.stats.crossDrops` | 2채널 마이크 간섭(높으면 마이크 배치 조정) |
| 번역 정확도 | 응대 로그 → 평가 JSON | 관리자 > 로그 > 응대 상세 > 평가 JSON → `node tools/eval/score.mjs <파일> --auto` |

## 폴더 구조

```
server.js              # 진입 한 줄 → server/index.js
server/                # config(환경변수·모델) · store(세션·사용자·용어, 파일/MongoDB) · auth(로그인·권한·2단계 인증)
                       #  · routes(REST, admin/) · realtime(WebSocket·방·호스트·뷰어)
                       #  · pipelines(soniox·desk·translate) · vendors(soniox·openai·cartesia·usage) · util
client/src/            # React 앱: shared(api·audio·theme·i18n) · session · phone(휴대폰 화면) · pc(PC 화면) · admin · auth
client/public/viewer/  # join.html(QR 뷰어 /j/<코드>) · desk.html(안내데스크 태블릿 /desk/<코드>) · overlay.html(자막 오버레이)
android/               # Android 앱(WebView + 네이티브 마이크) → android/README.md
desktop/               # Windows·macOS 데스크톱 앱(Electron) → desktop/README.md
test/                  # 서버 테스트(npm test) · test/e2e 화면 테스트(npm run test:e2e)
tools/eval/            # 번역 품질·지연 평가 도구(실제 서비스 호출, 과금) → tools/eval/README.md
docs/                  # 보안·안내데스크 운영 문서, 설계 기록
```

개발 기록·WebSocket 메시지 형식·화면 표시 규칙은 `PROJECT_NOTES.md` 에 있습니다.
