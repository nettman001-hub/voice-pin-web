# VoiceCAP 댓글 도우미

틱톡 라이브 댓글을 VoiceCAP 웹앱으로 전달하는 Windows용 설치 프로그램입니다.

## 판매자 사용법

1. `VoiceCAP-Comment-Helper-Setup.exe`를 한 번 실행합니다.
2. 설치가 끝나면 컴퓨터를 켤 때 댓글 도우미가 자동으로 실행됩니다.
3. VoiceCAP 웹앱에서 틱톡 아이디를 설정하고 라이브를 시작합니다.

PowerShell, Node.js, `npm install`, 환경변수, 포트 설정은 판매자가 알 필요가 없습니다. 창을 닫아도 작업표시줄 오른쪽의 VoiceCAP 아이콘에서 백그라운드로 계속 작동합니다.

## 개발자 빌드

저장소 루트에 `eulerstream_key.txt`가 있으면 빌드 시 설치 파일에 포함합니다. 파일이 없으면 Euler Stream 커뮤니티 모드로 동작합니다.

```powershell
cd desktop/comment-helper
npm install
npm run dist
```

결과 파일은 `release/VoiceCAP-Comment-Helper-Setup.exe`입니다. 설치 파일에 API 키를 포함하는 방식은 초기 배포용이며, 장기적으로는 판매자별 서버 토큰을 발급하는 방식으로 전환해야 합니다.

## 배포와 업데이트

GitHub Release에 `VoiceCAP-Comment-Helper-Setup.exe`, `latest.yml`, `*.blockmap`을 함께 업로드하면 설치된 도우미가 주기적으로 새 버전을 확인하고 다음 종료 시 자동 업데이트합니다.

Windows에서 다운로드 경고를 없애려면 배포용 코드 서명 인증서로 설치 파일을 서명해야 합니다. 서명되지 않은 파일은 기능상 설치할 수 있지만 SmartScreen에서 추가 확인이 나타날 수 있습니다.
