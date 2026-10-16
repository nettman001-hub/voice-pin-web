# VoiceCAP 바탕화면 바로가기 생성 스크립트
$wscriptShell = New-Object -ComObject WScript.Shell
$desktopPath = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path -Path $desktopPath -ChildPath "VoiceCAP 시작.lnk"

$targetPath = "C:\dev\voicecap-web\start-voicecap.bat"
$workingDir = "C:\dev\voicecap-web"

$shortcut = $wscriptShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $workingDir
$shortcut.Description = "VoiceCAP 브리지 서버 및 TikTok/웹앱 동시 실행"
# 크롬이나 명령프롬프트 아이콘 지정 가능 (기본 cmd 아이콘 또는 chrome 아이콘)
if (Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe") {
    $shortcut.IconLocation = "C:\Program Files\Google\Chrome\Application\chrome.exe,0"
} elseif (Test-Path "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") {
    $shortcut.IconLocation = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe,0"
}
$shortcut.Save()

Write-Host "[성공] 바탕화면에 'VoiceCAP 시작' 바로가기가 생성되었습니다: $shortcutPath" -ForegroundColor Green
