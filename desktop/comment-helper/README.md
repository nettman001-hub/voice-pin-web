# VoiceCAP 댓글 도우미

틱톡 라이브 댓글을 VoiceCAP 홈페이지로 전달하는 Windows용 설치 프로그램입니다.

## 판매자 사용법

1. `VoiceCAP-Comment-Helper-Setup.exe`를 한 번 실행합니다.
2. 설치가 끝나면 컴퓨터를 켤 때 댓글 도우미가 자동으로 실행됩니다.
3. VoiceCAP 홈페이지에서 틱톡 아이디를 설정하고 라이브를 시작합니다.

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

배포 전 저장소 루트에서 `node scripts/verify-comment-helper-startup.mjs`로 패키징된 실행 파일의 시작, 서버 응답, 단일 실행 및 종료를 확인합니다. 판매자 설정에 영향을 주지 않도록 별도 프로필을 사용합니다. 관련 소스를 커밋한 후 `npm run upload`를 실행하면 설치 파일과 업데이트 메타데이터의 버전·크기·SHA512를 검증하고, 임시 릴리스의 모든 파일 업로드를 확인한 뒤 공개합니다. 웹 다운로드 버전은 공개한 태그와 일치해야 합니다.

1.3.8에서 설치 진행창만 사라지고 앱이 열리지 않는 경우, 1.3.9 이상 설치 파일을 다시 받아 설치합니다. 설치 후 앱이 같은 실행 파일 이름의 프로세스를 종료하면서 자신까지 종료하던 문제를 수정했습니다. 기존 프린터 설정은 유지됩니다.

Windows에서 다운로드 경고를 없애려면 배포용 코드 서명 인증서로 설치 파일을 서명해야 합니다. 서명되지 않은 파일은 기능상 설치할 수 있지만 SmartScreen에서 추가 확인이 나타날 수 있습니다.
