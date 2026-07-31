# church-admin-media-web

미디어 서버(`church-media-server`, Socket.IO)를 제어하는 관리자 대시보드.

## 구조

```
브라우저 (html/css/ts)
  │  fetch (명령) · SSE (실시간 상태)
  ▼
FastAPI 백엔드 ── python-socketio ──▶ 미디어 서버 (Socket.IO)
(웹 로그인 · 세션 · REST · SSE)        단일 관리자 소켓 = 콘솔
```

- **backend/** — FastAPI. 브라우저와 통신하고, 미디어 서버에 단일 관리자 소켓(브리지)을 유지한다. 명령은 브리지로 중계하고, 미디어 서버의 실시간 상태는 SSE로 브라우저에 내보낸다.
- **frontend/** — html + css + ts(번들러 없이 `tsc`로 ESM 컴파일). 소켓 라이브러리 없이 `fetch` + `EventSource`만 사용한다.

## 인증

관리자 비밀번호 하나로 일원화한다. 미디어 서버의 `ADMIN_PASSWORD_HASH`(scrypt) 문자열을 백엔드 `.env`에도 그대로 넣는다(같은 비밀번호 = 같은 해시). 웹 로그인은 이 해시로 검증하고, 검증된 평문은 프로세스 메모리에만 보관해 브리지의 관리자 인증에 사용한다(디스크에는 해시만 존재).

## 실행

### 백엔드

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env   # 값 채우기 (ADMIN_PASSWORD_HASH, SESSION_SECRET 등)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 프론트엔드 (빌드)

```bash
cd frontend
npm install
npm run build     # src → web/js (개발 중에는 npm run watch)
```

빌드 후 FastAPI가 `frontend/web/`을 정적 서빙하므로 `http://<host>:8000/` 으로 접속한다.

## 락 동작 (미디어 서버와 동일)

- **오디오 락**: 기기가 전이 중(재생/정지/곡변경)일 때만 잡힘. 이때는 관리자 포함 모두 오디오 컨트롤이 막힌다(기기 사용 중 락).
- **관리자 락**: 비관리자 제출을 막는 전역 게이트. 관리자 콘솔(브리지)은 항상 admin이라 이 락에 막히지 않는다.
