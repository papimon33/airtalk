# TLS 인증서

HTTPS 모드(`NGINX_MODE=https`, 기본)에서 nginx 가 읽습니다. 이 폴더에 두 파일을 넣습니다.

- `fullchain.pem` — 인증서 + 중간 인증서
- `privkey.pem` — 개인키

이 폴더의 인증서 파일은 git 에 올라가지 않습니다(`.gitignore`).
