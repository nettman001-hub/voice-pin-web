# voicecap-comment-server

틱톡 라이브 댓글을 **실시간으로 수집**해서 Vercel 웹앱(브라우저)으로 전달하는 윈도우 로컬 서버.

```
[TikTok LIVE] <--WSS-- [본 서버: tiktok-live-connector] --Socket.IO--> [웹앱 브라우저]
```

## 최초 설정 (1회)

```powershell
cd server
npm install
copy .env.example .env   # 필요 시 수정 (기본값으로 바로 사용 가능)
```

- Euler Stream API 키: 저장소 **루트 폴더의 `eulerstream_key.txt`** 를 자동으로 읽는다.
  (또는 `server/.env`의 `EULERSTREAM_API_KEY`로 지정 가능)
  키 발급: https://www.eulerstream.com 무료 가입 → Dashboard → API Keys

## 실행

```powershell
cd server
npm start          # 또는 npm run dev (파일 변경 감지)
```

기동 확인: 브라우저에서 http://127.0.0.1:2137/status

## Windows 부팅 시 자동 시작 (선택)

PM2 사용:

```powershell
npm install -g pm2
pm2 start index.js --name voicecap-server
pm2 save
npm install -g pm2-windows-startup
pm2-startup install
```

## 포트/보안

- `127.0.0.1:2137` 에서만 리슨 → 외부 노출 없음
- CORS: `ALLOWED_ORIGINS`(기본: vercel 앱 + localhost 개발 서버)만 허용

## 웹앱과의 이벤트 규격 (Socket.IO)

| 방향 | 이벤트 | 내용 |
|---|---|---|
| 서버→클라 | `tiktok:status` | `{state, username, message, viewerCount, totalComments, ...}` state: idle/connecting/collecting/waiting_live/ended/error |
| 서버→클라 | `comment:new` | `{id, uniqueId, nickname, content, receivedAt, userId?}` |
| 서버→클라 | `tiktok:stats` | 시청자 수 갱신 (status와 동일 페이로드) |
| 클라→서버 | `collect:start` | `{username}` — 수집 시작 |
| 클라→서버 | `collect:stop` | 수집 중지 |

## 참고

- WebSocket URL 서명은 Euler Stream 외부 서명 서비스를 거친다 (역엔지니어링 라이브러리 특성상).
  틱톡 프로토콜 변경 시 `tiktok-live-connector` 버전 업데이트로 대응.
- 방송이 꺼져 있으면 30초 간격으로 방송 시작 여부를 확인하고 자동으로 붙는다.
