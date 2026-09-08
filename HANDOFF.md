# VoiceCAP 개발 인계인수서 (HANDOFF)

> **기준일**: 2026-09-09 (Asia/Seoul)
> **상세 종합 문서**: [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md)
> **안드로이드 상세 매뉴얼**: [docs/ANDROID_APP_USER_GUIDE.md](docs/ANDROID_APP_USER_GUIDE.md)
> **공식 저장소**: [https://github.com/nettman001-hub/voice-pin-web.git](https://github.com/nettman001-hub/voice-pin-web.git)  
> **운영 브랜치**: `main`  
> **작업 브랜치**: `codex/product-sales-single-agent`  
> **작업 경로**: `C:\dev\voice-pin-anti`

---

## 1. 운영 기준점

| 항목 | 값 / 상세 정보 |
| :--- | :--- |
| **Git 저장소** | `https://github.com/nettman001-hub/voice-pin-web.git` |
| **브랜치** | `main` |
| **운영 웹** | `https://www.voicecap.shop` |
| **Vercel 프로젝트** | `voice-pin-web` |
| **Supabase 프로젝트 ref** | `ymegrhxpbeanvxwdzfym` (sermon-guide-db 공유 인프라) |
| **Edge Functions** | `sales-api`, `voicecap-onboard`, `device-pair`, `sms-bridge` |
| **프런트엔드** | React 18, TypeScript, Vite, Tailwind CSS |
| **데스크톱 도우미** | `v1.3.5` (Windows x64 Electron 44, Xprinter 감열식 출력, 하이브리드 STT) |
| **안드로이드 앱** | `v1.3.2` (Java 17, `shop.voicecap.smsbridge`, compileSdk 35 / targetSdk 36) |

`main` 브랜치에 push하면 Vercel Production 배포가 자동으로 실행됩니다.

> [!IMPORTANT]
> Supabase Edge Functions는 GitHub/Vercel 자동 배포 대상이 아닙니다. `supabase/functions/sales-api` 또는 `voicecap-onboard`를 수정한 경우 Supabase CLI(`npx supabase functions deploy <func-name> --no-verify-jwt`) 또는 Supabase Dashboard Code 편집기에서 'Deploy updates'를 실행해야 합니다.

---

## 2. 2026-09-08 완료된 주요 구현 사항 (상품 중심 판매관리)

1. **공통 계약 및 검증 프레임워크 (`contracts/product-sales/v1/`)**:
   - JSON Schema v1 및 13개 액션 계약 완비.
   - 44개 통합 테스트 자동 검증 통과 (`npm test`).
2. **Supabase DDL 및 Edge Functions (`supabase/`)**:
   - `supabase/migrations/202609080001_product_sales_core.sql` (세션, 상품, 판매, 구매자, 출력 큐, 기기 권한).
   - `supabase/functions/sales-api/index.ts` (13개 공통 액션, 멱등성, 낙관적 락, 테넌트 격리).
3. **웹 프론트엔드 실시간 대시보드 (`src/`)**:
   - `LiveHomePage.tsx`: 회차 요약 카드, 실시간 댓글 피드(1인 다중댓글 통합), 판매 확정.
   - `ProductRegistrationModal.tsx`: 2초 타이머 카메라/번호이미지 대체, 선행 0 보존(`0007`).
   - `ProductChangeModal.tsx`: 단가 소급 수정, 구매자 수량/제외 편집, 미리보기 차액 확인, 정정 전표 발행.
   - `DeviceManagementPage.tsx`: 모바일 기기 판매 권한 부여 및 출력 대상 프린터 지정.
4. **데스크톱 댓글 도우미 & 영수증 프린터 (`desktop/comment-helper/` & `server/`)**:
   - `server/cloudPrintWorker.js` / `server/printJobStore.js`: 클라우드 인쇄 큐 폴링 및 Xprinter 영수증 자동 인쇄.
   - 판매 전표(`SALE`), 정정 전표(`CORRECTION`), 취소 전표(`CANCEL`), 요약 전표(`SUMMARY`) 지원.
5. **안드로이드 모바일 통합 앱 (`android/voicecapSMS/`)**:
   - `MainActivity.java`: 듀얼 탭 구조 (`🛍 판매관리` & `💬 문자연동`).
   - 완전한 권한 격리: 판매관리 탭은 SMS 권한 없이도 독립 작동.
   - 실기기 설치 파일: `android/voicecapSMS/build/voicecap-sms-v1.3.2-install.apk` (약 697 KB).
   - 스토어 배포 번들: `app/build/outputs/bundle/release/app-release.aab` (약 688 KB).

## 3. 2026-09-09 운영 배포 상태

- 운영 DB 마이그레이션 `202609050002`, `202609080001` 적용 완료.
- `sales-api` v1, `voicecap-onboard` v6, `device-pair` v2, `sms-bridge` v2 ACTIVE 확인.
- 관리자 집계 RPC는 익명 호출이 거부되도록 보강했으며 운영 응답 `401 / 42501` 확인.
- 웹 Production은 커밋 `cc811a8` 기준 Ready, `voicecap.shop` 및 `www.voicecap.shop` 연결 확인.
- 데스크톱 도우미 v1.3.5와 Android v1.3.2는 GitHub Releases에 게시 완료.
- Google Play 배포는 해당 Google 계정에 Play Console 개발자 계정이 없어 미완료. 계정 생성·운영자 정보 등록 후 AAB를 내부 테스트 트랙에 올려야 함.

---

## 4. 회원·인증 및 보안 아키텍처

- **회원 및 권한 원본**: Supabase Auth 및 Postgres DB.
- **관리자 계정**: `nettman@naver.com` (`app_metadata.role = ADMIN`, `workspace_members.role = MANAGER`).
- **세션 유지 정책**: `persistSession = false` 기반, 브라우저 새로고침 시 `sessionStorage`의 refresh token으로 세션 재발급 (탭/브라우저 종료 시 로그아웃).
- **공용 STT 설정**: 관리자 작업공간의 `workspace_settings` (`namespace = 'voicecap-global-stt'`)에 보관되며, 권한이 부여된 판매자에게만 Edge Function을 통해 전달.
- **기기 보안 토큰**: 모바일 기기는 `device_pairings` 테이블에 기록된 SHA-256 해시 토큰(`X-VoiceCAP-Device-Token`)을 사용하며, 권한 배열(`permissions`)로 제어.

---

## 5. 새 컴퓨터 빠른 시작 요약

```powershell
# 1. 저장소 클론 및 패키지 설치
git clone https://github.com/nettman001-hub/voice-pin-web.git C:\dev\voicecap-web
cd C:\dev\voicecap-web
npm install
cd server; npm install; cd ..
cd desktop/comment-helper; npm install; node scripts/stage-server.cjs; cd ../..

# 2. 전체 단위 및 계약 검증 (44개 패스)
npm test

# 3. 웹 프론트엔드 빌드 검증
npm run build

# 4. 서버 및 데스크톱 테스트
cd server; npm test; cd ..
cd desktop/comment-helper; npm test; cd ../..

# 5. 안드로이드 빌드 (Microsoft OpenJDK 17 필요)
cd android/voicecapSMS
.\gradlew.bat :app:assembleDebug
```

> **자세한 새 컴퓨터 설정 및 트러블슈팅**: [PROJECT_HANDOVER.md](file:///c:/dev/voicecap-web/PROJECT_HANDOVER.md)를 참조하세요.
