param([string]$OutputDirectory = "scratch/soniox-integration.local")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
[System.IO.Directory]::CreateDirectory($taskOutput) | Out-Null
$taskSynthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $taskVoice = $taskSynthesizer.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'ko-KR' -and $_.Enabled } | Select-Object -First 1
  if (!$taskVoice) { throw 'An installed Korean Windows speech voice is required.' }
  $taskSynthesizer.SelectVoice($taskVoice.VoiceInfo.Name)
  $taskSynthesizer.Rate = -1
  $taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $taskPhrases = @(
    '테스트 방송입니다. 루비 언니, 검정색 가디건 만 팔천 원에 드릴게요.',
    '유 언니, 베이지 니트 구천 원에 드릴게요.',
    '민트 언니, 청바지 이만 원에 드릴게요. 테스트를 종료합니다.'
  )
  for ($taskIndex = 0; $taskIndex -lt $taskPhrases.Count; $taskIndex++) {
    $taskFile = Join-Path $taskOutput ("phrase-{0}.wav" -f ($taskIndex + 1))
    $taskSynthesizer.SetOutputToWaveFile($taskFile, $taskFormat)
    $taskSynthesizer.Speak($taskPhrases[$taskIndex])
    $taskSynthesizer.SetOutputToNull()
  }
  Write-Output ("Generated {0} fictional Korean test phrases with {1} in {2}" -f $taskPhrases.Count, $taskVoice.VoiceInfo.Name, $taskOutput)
} finally { $taskSynthesizer.Dispose() }
