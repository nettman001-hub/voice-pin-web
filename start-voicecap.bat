@echo off
chcp 65001 >nul
title VoiceCAP 실행기

echo ===================================================
echo   VoiceCAP 원클릭 실행 중...
echo ===================================================
echo.

:: 1. 현재 배치 파일 위치 기준 server 폴더로 이동하여 브리지 서버 별도창 실행
cd /d "%~dp0server"

echo [1/3] VoiceCAP 로컬 브리지 서버를 시작합니다...
start "VoiceCAP Server" cmd /k "npm start"

:: 서버 기동 대기 (2초)
timeout /t 2 /nobreak >nul

:: 2. 틱톡 라이브 및 VoiceCAP 웹앱 URL 설정
set "TIKTOK_URL=https://www.tiktok.com/live"
set "VOICECAP_URL=https://www.voicecap.shop"

echo [2/3] 크롬 브라우저로 틱톡 라이브 창을 엽니다...
where chrome >nul 2>nul
if %ERRORLEVEL% equ 0 (
    start chrome --new-window "%TIKTOK_URL%"
) else (
    start "" "%TIKTOK_URL%"
)

timeout /t 1 /nobreak >nul

echo [3/3] 크롬 브라우저로 VoiceCAP 창을 엽니다...
where chrome >nul 2>nul
if %ERRORLEVEL% equ 0 (
    start chrome "%VOICECAP_URL%"
) else (
    start "" "%VOICECAP_URL%"
)

echo.
echo ===================================================
echo   실행 완료! VoiceCAP과 TikTok 창이 열렸습니다.
echo ===================================================
timeout /t 2 >nul
exit
