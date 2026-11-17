# AirTalk Docker 설치 안내서

서버 1대에 **nginx(HTTPS·웹소켓) + AirTalk 앱** 두 컨테이너로 운영하는 방법입니다. 클라우드 가상 서버나 공사 DMZ 서버 모두 같은 방식입니다.

## 1. 준비물

| 항목 | 내용 |
|---|---|
| 서버 | Linux, 1 vCPU · 2GB 메모리 · SSD 30GB 이상(동시 마이크 30~40개 기준) |
| 프로그램 | Docker Engine, Docker Compose v2(`docker compose` 명령) |
| 도메인·인증서 | 예: `airtalk.kr`. 인증서 파일 `fullchain.pem`·`privkey.pem` |
| API 키 | OpenAI·Soniox(필수), Cartesia(번역 음성, 선택) |

**방화벽**

| 방향 | 대상 | 포트 |
|---|---|---|
| 들어오는 쪽 | 인터넷 → 서버 | TCP 443(HTTPS), 80(HTTPS 로 넘기기, 선택) |
| 나가는 쪽 | 서버 → `stt-rt.soniox.com`, `api.openai.com`, `api.cartesia.ai` | TCP 443 |
| 나가는 쪽(선택) | 서버 → `api.soniox.com`(사용량 조회), `api.github.com`(앱 설치본 정보) | TCP 443 |

서버 관리 접속(SSH)은 공사 서버 접근통제(NGS)를 거칩니다.

## 2. 파일 구성

```
Dockerfile                      앱 이미지(화면 빌드 포함)
docker-compose.yml              nginx + 앱, 데이터 볼륨
deploy/nginx/https.conf.template  HTTPS 모드(기본)
deploy/nginx/http.conf.template   HTTP 모드(로컬 시험, 앞단 장비가 HTTPS 처리)
deploy/nginx/proxy.inc.template   앱으로 넘기는 설정(웹소켓 유지)
deploy/certs/                   인증서를 넣는 곳(git 에 올라가지 않음)
deploy/ca/                      회사 보안 장비 루트 인증서를 넣는 곳(필요할 때만)
```

## 3. 설정(.env)

저장소의 `.env.example` 을 `.env` 로 복사해 채웁니다. 운영에서는 아래 값을 꼭 넣습니다.

| 변수 | 설명 |
|---|---|
| `OPENAI_API_KEY`, `SONIOX_API_KEY` | 필수 API 키 |
| `CARTESIA_API_KEY` | 번역 음성(선택) |
| `ADMIN_ID`, `ADMIN_PASSWORD` | 관리자 계정. 기본값(admin)이면 서버가 시작되지 않습니다 |
| `AUTH_SECRET` | 로그인 쿠키 서명 키(긴 무작위 문자열). 없으면 서버가 시작되지 않습니다 |
| `DATA_KEY` | 저장 데이터 암호화 키(긴 무작위 문자열). **잃어버리면 데이터를 읽을 수 없으니 따로 보관하세요** |
| `PUBLIC_HOST` | 운영 도메인(예: `airtalk.kr`). QR 주소가 이 도메인으로 만들어집니다 |

Docker 전용 변수(필요할 때만):

| 변수 | 기본값 | 설명 |
|---|---|---|
| `NGINX_MODE` | `https` | `http` 는 로컬 시험이나 앞단 웹 방화벽이 HTTPS 를 처리할 때 |
| `SERVER_NAME` | `_` | nginx 서버 이름(도메인) |
| `ADMIN_ALLOW` | `all` | 관리자 화면·관리자 API 를 열어 줄 IP 대역(예: `10.0.0.0/8`) |
| `HTTP_PORT`, `HTTPS_PORT` | `80`, `443` | 서버에서 여는 포트 |
| `TRUST_PROXY` | `1` | 앱 앞의 프록시 수. 웹 방화벽 + nginx 면 `2` |
| `REAL_IP_FROM` | `127.0.0.1/32` | HTTP 모드에서 앞단 장비의 IP 대역(관리자 IP 제한이 실제 접속자 기준이 되게) |
| `AIRTALK_TAG` | `latest` | 실행할 이미지 태그(되돌리기에 사용) |

`AUTH_SECRET`·`DATA_KEY` 생성 예: `openssl rand -hex 32`

## 4. 처음 실행

```bash
cp /경로/fullchain.pem /경로/privkey.pem deploy/certs/
docker compose up -d --build
docker compose ps              # airtalk 이 healthy 가 되면 정상
curl -k https://localhost/health
```

브라우저에서 `https://도메인` 에 접속해 관리자 계정으로 로그인합니다.

**로컬 시험(인증서 없이):** `.env` 에 `NGINX_MODE=http`, `HTTP_PORT=8088` 을 넣고 실행한 뒤 `http://localhost:8088` 로 접속합니다. 마이크는 localhost 에서 동작합니다.

## 5. 업데이트(이미지 교체)

DMZ 처럼 서버에서 인터넷 패키지를 받기 어려우면, 인터넷이 되는 PC에서 이미지를 만들어 옮깁니다.

```bash
# 인터넷 PC
docker compose build
docker tag airtalk:latest airtalk:2026-11-17
docker save airtalk:2026-11-17 | gzip > airtalk-2026-11-17.tar.gz

# 서버(파일 반입 후)
gunzip -c airtalk-2026-11-17.tar.gz | docker load
AIRTALK_TAG=2026-11-17 docker compose up -d      # 또는 .env 에 AIRTALK_TAG 지정
```

- 데이터는 볼륨(`airtalk-data`)에 있어 이미지를 바꿔도 그대로 남습니다.
- **되돌리기:** 이전 태그로 `AIRTALK_TAG` 를 바꿔 다시 `docker compose up -d` 합니다.
- 번역 중이던 연결은 끊기므로 사용이 적은 시간에 합니다.

## 6. 백업과 복구

데이터(세션·대화 기록·계정·설정·접속 로그)는 볼륨 `airtalk_airtalk-data` 하나에 모두 있습니다.

```bash
# 백업(잠깐 앱을 멈추고 묶는다 — SQLite 파일을 일관되게)
docker compose stop airtalk
docker run --rm -v airtalk_airtalk-data:/data -v "$PWD":/backup alpine tar czf /backup/airtalk-data-$(date +%Y%m%d).tgz -C /data .
docker compose start airtalk

# 복구
docker compose stop airtalk
docker run --rm -v airtalk_airtalk-data:/data -v "$PWD":/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/airtalk-data-YYYYMMDD.tgz -C /data"
docker compose start airtalk
```

클라우드 디스크 스냅숏을 함께 쓰면 더 안전합니다. `DATA_KEY` 는 백업과 다른 곳에 보관합니다.

⚠ `docker compose down -v` 는 **데이터 볼륨까지 지웁니다.** 운영 서버에서는 `-v` 를 붙이지 마세요.

## 7. 로그

| 로그 | 위치 |
|---|---|
| 앱·nginx 실행 로그 | `docker compose logs -f airtalk` / `docker compose logs -f nginx` (파일당 10MB, 5개까지 보관) |
| 접속·관리 로그(1년 보관) | 볼륨 안 `logs/audit-YYYY-MM-DD.jsonl`. 서버 경로: `/var/lib/docker/volumes/airtalk_airtalk-data/_data/logs/` |

관제 수집기는 접속·관리 로그 폴더를 읽게 설정하면 됩니다. 비밀번호·대화 내용은 들어 있지 않습니다.

## 8. 회사 보안 장비가 HTTPS 를 다시 서명하는 망

빌드 중 `npm ci` 가 인증서 오류로 실패하거나, 실행 중 외부 AI 접속이 실패하면 이 경우입니다.

1. 그 장비의 루트 인증서를 PEM 으로 받아 `deploy/ca/` 에 넣습니다(git 에 올라가지 않음).
2. `docker compose build` 로 다시 만듭니다. 빌드와 실행 모두 이 인증서를 믿게 됩니다.

인증서 검증을 끄는 것이 아니라, 회사가 이미 신뢰하는 인증서를 함께 믿게 하는 방식입니다.

## 9. 기본 동작 메모

- 엔진으로 보내는 음성은 Opus(32kbps)로 압축됩니다. 끄려면 `.env` 에 `SONIOX_AUDIO_CODEC=pcm`.
- 대화 기록은 90일이 지나면 자동으로 지워집니다. 바꾸려면 `TRANSCRIPT_RETENTION_DAYS`(0 이면 무기한).
- 컨테이너는 관리자 권한(root)이 아닌 `node` 사용자로 실행됩니다.
