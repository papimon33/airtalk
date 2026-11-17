# AirTalk 서버 이미지 — 화면 빌드(dist)까지 이미지 안에 넣는다. 서버에는 이 이미지와 .env·데이터 볼륨만 있으면 된다.
# 빌드: docker compose build   (또는 docker build -t airtalk .)
# 회사 보안 장비가 HTTPS 를 중간에서 다시 서명하는 망이면 그 루트 인증서(.pem)를 deploy/ca/ 에 넣고 빌드한다(npm·외부 AI 접속용).

# ---- 1단계: 화면 빌드(개발 도구 포함, 최종 이미지에 남지 않음) ----
FROM node:22-slim AS build
WORKDIR /app
COPY deploy/ca/ /tmp/ca/
COPY package.json package-lock.json ./
RUN set -e; \
    if ls /tmp/ca/*.pem >/dev/null 2>&1; then cat /tmp/ca/*.pem > /tmp/extra-ca.pem; export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    npm ci --no-audit --no-fund
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# ---- 2단계: 실행용 ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY deploy/ca/ /app/ca/
COPY package.json package-lock.json ./
# 추가 루트 인증서는 빌드 때 하나로 묶어 둔다(/app/ca/ca-bundle.crt) — 실행 시 node 사용자가 파일을 만들 필요 없게
RUN set -e; \
    if ls /app/ca/*.pem >/dev/null 2>&1; then cat /app/ca/*.pem > /app/ca/ca-bundle.crt; export NODE_EXTRA_CA_CERTS=/app/ca/ca-bundle.crt; fi; \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY server ./server
COPY --from=build /app/dist ./dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/airtalk-entrypoint
# 데이터 폴더(볼륨으로 연결) — 처음 만든 볼륨이 이 권한을 물려받아 node 사용자로 쓸 수 있다
RUN chmod +x /usr/local/bin/airtalk-entrypoint && mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["airtalk-entrypoint"]
CMD ["node", "server.js"]
