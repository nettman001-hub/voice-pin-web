[CmdletBinding()]
param(
    [string]$KeyAlias = 'voicecap-upload',
    [string]$DistinguishedName = 'CN=VoiceCAP, OU=Mobile, O=VoiceCAP, C=KR'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$androidDir = Join-Path $repoRoot 'android\voicecapSMS'
$signingDir = Join-Path $androidDir 'signing'
$keyStorePath = Join-Path $signingDir 'voicecap-upload.jks'
$certificatePath = Join-Path $signingDir 'voicecap-upload-certificate.pem'

function ConvertFrom-SecureValue([Security.SecureString]$secureValue) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

if (Test-Path $keyStorePath) {
    throw "기존 업로드 키를 덮어쓰지 않습니다: $keyStorePath"
}

$javaHome = $env:JAVA_HOME
if (-not $javaHome -or -not (Test-Path (Join-Path $javaHome 'bin\keytool.exe'))) {
    $javaHome = 'C:\Program Files\Android\Android Studio\jbr'
}
$keyTool = Join-Path $javaHome 'bin\keytool.exe'
if (-not (Test-Path $keyTool)) { throw 'keytool.exe를 찾지 못했습니다. Android Studio/JDK 21을 설치하세요.' }

$firstSecure = Read-Host '업로드 키 비밀번호(12자 이상, 화면에 표시되지 않음)' -AsSecureString
$secondSecure = Read-Host '업로드 키 비밀번호 확인' -AsSecureString
$first = ConvertFrom-SecureValue $firstSecure
$second = ConvertFrom-SecureValue $secondSecure

try {
    if ($first.Length -lt 12) { throw '비밀번호는 12자 이상이어야 합니다.' }
    if ($first -cne $second) { throw '비밀번호가 일치하지 않습니다.' }

    New-Item -ItemType Directory -Path $signingDir -Force | Out-Null
    & $keyTool -genkeypair -v -keystore $keyStorePath -storepass $first -keypass $first -alias $KeyAlias -keyalg RSA -keysize 4096 -validity 10000 -dname $DistinguishedName
    if ($LASTEXITCODE -ne 0) { throw '업로드 키 생성 실패' }

    & $keyTool -exportcert -rfc -keystore $keyStorePath -storepass $first -alias $KeyAlias -file $certificatePath
    if ($LASTEXITCODE -ne 0) { throw '업로드 인증서 내보내기 실패' }

    $env:VOICECAP_UPLOAD_KEYSTORE = $keyStorePath
    $env:VOICECAP_UPLOAD_STORE_PASSWORD = $first
    $env:VOICECAP_UPLOAD_KEY_ALIAS = $KeyAlias
    $env:VOICECAP_UPLOAD_KEY_PASSWORD = $first
    $env:JAVA_HOME = $javaHome
    $env:Path = "$javaHome\bin;$env:Path"

    Push-Location $androidDir
    try {
        & .\gradlew.bat :app:bundleRelease
        if ($LASTEXITCODE -ne 0) { throw '서명 AAB 빌드 실패' }
    } finally { Pop-Location }
} finally {
    $env:VOICECAP_UPLOAD_KEYSTORE = $null
    $env:VOICECAP_UPLOAD_STORE_PASSWORD = $null
    $env:VOICECAP_UPLOAD_KEY_ALIAS = $null
    $env:VOICECAP_UPLOAD_KEY_PASSWORD = $null
    $first = $null
    $second = $null
}

Write-Host "업로드 키: $keyStorePath" -ForegroundColor Green
Write-Host "공개 인증서: $certificatePath" -ForegroundColor Green
Write-Host "서명 AAB: $(Join-Path $androidDir 'app\build\outputs\bundle\release\app-release.aab')" -ForegroundColor Green
Write-Host 'JKS와 비밀번호를 암호화된 오프라인 저장소 및 비밀번호 관리자에 각각 백업하세요.' -ForegroundColor Yellow
