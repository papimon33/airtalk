#!/bin/sh
# AirTalk 컨테이너 시작 — 회사 보안 장비 루트 인증서가 이미지에 들어 있으면(빌드 때 deploy/ca/*.pem 을 묶은 /app/ca/ca-bundle.crt)
# Node 가 믿도록 알려 준다. 외부 AI 서비스(Soniox·OpenAI·Cartesia) 접속이 중간에서 다시 서명되는 망에서만 필요하다.
# 인증서 검증 자체는 끄지 않는다.
set -e
if [ -f /app/ca/ca-bundle.crt ] && [ -z "$NODE_EXTRA_CA_CERTS" ]; then
  export NODE_EXTRA_CA_CERTS=/app/ca/ca-bundle.crt
fi
exec "$@"
