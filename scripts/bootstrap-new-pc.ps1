[CmdletBinding()]
param(
    [switch]$EnableLanBridge,
    [switch]$SkipEulerKey,
    [switch]$SkipAndroid,
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serverDir = Join-Path $repoRoot 'server'
$androidDir = Join-Path $repoRoot 'android\voicecapSMS'

function Write-Step([string]$message) {
    Write-Host "`n==> $message" -ForegroundColor Cyan
}

function ConvertFrom-SecureValue([Security.SecureString]$secureValue) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Find-AndroidSdk {
    $candidates = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
    ) | Where-Object { $_ -and (Test-Path $_) }
    return $candidates | Select-Object -First 1
}

function Find-JavaHome {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
        return $env:JAVA_HOME
    }
    $androidStudioJbr = 'C:\Program Files\Android\Android Studio\jbr'
    if (Test-Path (Join-Path $androidStudioJbr 'bin\java.exe')) { return $androidStudioJbr }
    return $null
}

Write-Step '필수 프로그램 확인'
foreach ($command in @('git.exe', 'node.exe', 'npm.cmd')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "$command 명령을 찾을 수 없습니다. Git과 Node.js를 먼저 설치하세요."
    }
}

Write-Step '프런트엔드와 로컬 서버 패키지 복원'
Push-Location $repoRoot
try { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw '루트 npm ci 실패' } }
finally { Pop-Location }

Push-Location $serverDir
try { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'server npm ci 실패' } }
finally { Pop-Location }

$serverEnv = Join-Path $serverDir '.env'
if (-not (Test-Path $serverEnv)) {
    Write-Step 'server/.env 생성'
    $template = [IO.File]::ReadAllText((Join-Path $serverDir '.env.example'))
    $randomBytes = New-Object byte[] 32
    $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $randomGenerator.GetBytes($randomBytes) }
    finally { $randomGenerator.Dispose() }
    $bridgeKey = ($randomBytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $hostValue = if ($EnableLanBridge) { '0.0.0.0' } else { '127.0.0.1' }
    $content = $template
    $content = [regex]::Replace($content, '(?m)^HOST=.*$', "HOST=$hostValue")
    $content = [regex]::Replace($content, '(?m)^SMS_BRIDGE_API_KEY=.*$', "SMS_BRIDGE_API_KEY=$bridgeKey")
    [IO.File]::WriteAllText($serverEnv, $content, [Text.UTF8Encoding]::new($false))
    Write-Host 'server/.env를 만들고 새로운 SMS_BRIDGE_API_KEY를 생성했습니다.' -ForegroundColor Green
    Write-Host 'Android 앱과 웹앱에는 server/.env의 같은 키를 입력하세요.' -ForegroundColor Yellow
} else {
    Write-Host '기존 server/.env를 유지했습니다.' -ForegroundColor Green
}

$eulerKeyFile = Join-Path $repoRoot 'eulerstream_key.txt'
if (-not $SkipEulerKey -and -not (Test-Path $eulerKeyFile)) {
    Write-Step 'Euler Stream API 키 입력'
    Write-Host '기존 PC의 키를 비밀번호 관리자/암호화 USB로 가져오거나 Euler Stream에서 재발급하세요.'
    $secureKey = Read-Host 'Euler Stream API 키(화면에 표시되지 않음)' -AsSecureString
    $plainKey = ConvertFrom-SecureValue $secureKey
    try {
        if ([string]::IsNullOrWhiteSpace($plainKey)) { throw 'Euler Stream API 키가 비어 있습니다.' }
        [IO.File]::WriteAllText($eulerKeyFile, $plainKey.Trim(), [Text.UTF8Encoding]::new($false))
    } finally {
        $plainKey = $null
    }
    Write-Host 'eulerstream_key.txt를 생성했습니다. Git에는 포함되지 않습니다.' -ForegroundColor Green
} elseif (Test-Path $eulerKeyFile) {
    Write-Host '기존 eulerstream_key.txt를 유지했습니다.' -ForegroundColor Green
}

Write-Step 'Vercel 로컬 토큰 처리'
Write-Host '.env.local의 VERCEL_OIDC_TOKEN은 복사하지 않습니다.'
Write-Host '배포할 때 새 PC에서 다음을 실행하세요: npm install -g vercel; vercel login; vercel link --project voice-pin-web'

if (-not $SkipAndroid) {
    Write-Step 'Android SDK와 local.properties 설정'
    $androidSdk = Find-AndroidSdk
    if (-not $androidSdk) {
        throw 'Android SDK를 찾지 못했습니다. Android Studio와 SDK Platform 35를 설치한 뒤 다시 실행하세요.'
    }
    $escapedSdk = $androidSdk.Replace('\', '\\').Replace(':', '\:')
    [IO.File]::WriteAllText((Join-Path $androidDir 'local.properties'), "sdk.dir=$escapedSdk`n", [Text.UTF8Encoding]::new($false))

    $javaHome = Find-JavaHome
    if (-not $javaHome) { throw 'JDK 21 또는 Android Studio JBR을 찾지 못했습니다.' }
    $env:JAVA_HOME = $javaHome
    $env:Path = "$javaHome\bin;$env:Path"
    Write-Host "Android SDK: $androidSdk" -ForegroundColor Green
    Write-Host "JAVA_HOME: $javaHome" -ForegroundColor Green
}

if (-not $SkipBuild) {
    Write-Step '전체 검증 및 산출물 재생성'
    Push-Location $repoRoot
    try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw '웹 빌드 실패' } }
    finally { Pop-Location }

    Push-Location $serverDir
    try { & npm.cmd test; if ($LASTEXITCODE -ne 0) { throw '서버 테스트 실패' } }
    finally { Pop-Location }

    if (-not $SkipAndroid) {
        Push-Location $androidDir
        try {
            & .\gradlew.bat :app:assembleDebug :app:lintDebug :app:bundleRelease
            if ($LASTEXITCODE -ne 0) { throw 'Android 빌드 실패' }
        } finally { Pop-Location }
    }
}

Write-Step '새 PC 초기화 완료'
Write-Host 'node_modules: npm ci로 재생성됨' -ForegroundColor Green
Write-Host 'server/.env: 존재함' -ForegroundColor Green
if (-not $SkipAndroid) {
    Write-Host 'Android local.properties 및 APK/AAB: 재생성됨' -ForegroundColor Green
    Write-Host '디버그 APK: android\voicecapSMS\app\build\outputs\apk\debug\app-debug.apk'
    Write-Host '서명 전 AAB: android\voicecapSMS\app\build\outputs\bundle\release\app-release.aab'
}
Write-Host '정식 Play 업로드 키는 scripts\create-android-upload-key.ps1로 최초 1회 생성하세요.' -ForegroundColor Yellow
if ($EnableLanBridge) {
    Write-Host 'HOST=0.0.0.0을 사용 중입니다. Windows 방화벽에서 2137 포트를 사설 네트워크에만 허용하세요.' -ForegroundColor Yellow
}
