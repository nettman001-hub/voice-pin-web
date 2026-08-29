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
- CORS: `ALLOWED_ORIGINS`(기본: voicecap.shop + vercel 앱 + localhost 개발 서버)만 허용
- 최신 크롬의 Private Network Access(PNA) 요구에 대응해 preflight에
  `Access-Control-Allow-Private-Network: true` 를 자동 응답한다.

## voicecapSMS 문자 연동

웹앱의 **정산서 관리 & 발송**과 구매 정보 대조는 이 서버의 SMS 브리지 API를 사용한다.

1. `.env`에서 `SMS_BRIDGE_API_KEY`를 예측하기 어려운 긴 값으로 바꾼다.
2. Android 폰과 이 PC가 같은 Wi-Fi에 있을 때만 `HOST=0.0.0.0`으로 변경하고, Windows 방화벽에서 포트 `2137`을 사설 네트워크로만 허용한다.
3. `android/voicecapSMS`를 Android Studio에서 열어 앱을 설치한다. 앱에 PC의 사설 IP 주소(예: `http://192.168.0.10:2137`), 같은 API 키, 웹앱과 같은 판매자 ID를 입력한다.
4. 앱에서 문자 권한과 기본 SMS 앱 역할을 허용한 뒤 **지금 동기화 및 발송 처리**를 누른다.

Android 앱은 SMS/MMS 수신 내용을 `/api/sms/incoming`으로 보내며 MMS 이미지는 최대 8개, 각각 4MB로 제한한다. 웹에서 큐에 넣은 문자는 `/api/sms/outbox`를 통해 폰이 전송한다. `SENT`는 Android OS에 전송을 요청한 상태이며, 통신사 수신 성공을 뜻하지는 않는다. 입금 알림 연동은 이후 앱에서 `/api/payments/incoming`으로 추가할 수 있도록 API만 준비되어 있다.

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
