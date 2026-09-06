@echo off
chcp 65001 >nul
echo =======================================================
echo   VoiceCAP 무료 오프라인 STT 엔진 원클릭 자동 설치 도구
echo =======================================================
echo.

set TARGET_VENV=%LOCALAPPDATA%\voicecap-comment-helper\venv

echo [1/4] Python 런타임 탐색 중...
set PYTHON_CMD=

where python >nul 2>nul
if %errorlevel% equ 0 (
    set PYTHON_CMD=python
) else (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        set PYTHON_CMD=py
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
        set PYTHON_CMD="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    ) else if exist "C:\Python311\python.exe" (
        set PYTHON_CMD="C:\Python311\python.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set PYTHON_CMD="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    )
)

if "%PYTHON_CMD%"=="" (
    echo [경고] 시스템에 Python이 설치되어 있지 않습니다.
    echo winget을 통해 Python 3.11 자동 설치를 시도합니다...
    winget install Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
    if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
        set PYTHON_CMD="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    ) else (
        echo [오류] Python 자동 설치에 실패했습니다. https://www.python.org 에서 Python 3.11을 설치해주세요.
        pause
        exit /b 1
    )
)

echo 사용 Python: %PYTHON_CMD%
echo.

echo [2/4] VoiceCAP 전용 독립 가상환경(venv) 생성 중...
echo 대상 경로: %TARGET_VENV%
if not exist "%TARGET_VENV%\Scripts\python.exe" (
    %PYTHON_CMD% -m venv "%TARGET_VENV%"
    if %errorlevel% neq 0 (
        echo [오류] 가상환경 생성 실패
        pause
        exit /b 1
    )
)
echo 가상환경 준비 완료.
echo.

echo [3/4] 오프라인 STT AI 엔진(faster-whisper) 패키지 설치 중...
"%TARGET_VENV%\Scripts\python.exe" -m pip install --upgrade pip
"%TARGET_VENV%\Scripts\python.exe" -m pip install faster-whisper ctranslate2 numpy

echo.
echo [4/4] 그래픽카드(GPU) 가속 드라이버 점검 중...
where nvidia-smi >nul 2>nul
if %errorlevel% equ 0 (
    echo [감지] NVIDIA GPU가 감지되었습니다. CUDA 가속 패키지를 설치합니다...
    "%TARGET_VENV%\Scripts\python.exe" -m pip install nvidia-cublas-cu12 nvidia-cudnn-cu12
    echo NVIDIA CUDA 가속 설정 완료.
) else (
    echo [안내] NVIDIA GPU가 감지되지 않았습니다. (AMD 라데온 또는 CPU 모드로 최적화됩니다)
)

echo.
echo =======================================================
echo   [성공] VoiceCAP 무료 오프라인 STT 엔진 설치가 완료되었습니다!
echo   VoiceCAP 댓글 도우미를 재시작하면 자동으로 로컬 STT가 활성화됩니다.
echo =======================================================
echo.
pause
