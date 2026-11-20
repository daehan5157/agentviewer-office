# Agentviewer 제거: 자동 실행 작업, 바로가기, 설치 폴더를 지웁니다.
# 설정·접속 코드(%USERPROFILE%\.agentviewer)는 남겨요 (-RemoveData 로 함께 삭제).
param(
  # run from the installed folder: that folder; otherwise the default location
  [string]$InstallDir = $(if (Test-Path (Join-Path $PSScriptRoot 'install.json')) { $PSScriptRoot } else { Join-Path $env:LOCALAPPDATA 'Agentviewer' }),
  [switch]$RemoveData
)
$ErrorActionPreference = 'Continue'
$info = Join-Path $InstallDir 'install.json'
$cfg = if (Test-Path $info) { Get-Content $info -Raw | ConvertFrom-Json } else { $null }
$taskName = if ($cfg -and $cfg.taskName) { $cfg.taskName } else { 'Agentviewer' }

Write-Host ''
Write-Host 'Agentviewer 제거' -ForegroundColor Cyan

# only remove the task if it runs this install (never another copy's task of the same name)
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
# (compared with the exact launcher path the installer registered: 8.3 short vs long paths differ as text)
$startScript = if ($cfg -and $cfg.startScript) { $cfg.startScript } else { Join-Path $InstallDir 'start.ps1' }
if ($task -and ($task.Actions | Where-Object { $_.Arguments -and $_.Arguments.Contains($startScript) })) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "  자동 실행 작업 삭제: $taskName"
}

$nodeExe = Join-Path $InstallDir 'node\node.exe'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $nodeExe) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "  실행 중인 Agentviewer 종료 (PID $($_.ProcessId))" }

foreach ($dir in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
  $lnk = Join-Path $dir 'Agentviewer.url'
  if (Test-Path $lnk) { Remove-Item -Force $lnk }
}

Start-Sleep -Milliseconds 500
if (Test-Path (Join-Path $InstallDir 'node\node.exe')) {
  # running from inside the folder: remove it after this script exits
  Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList '/c', "timeout /t 2 /nobreak >nul & rmdir /s /q `"$InstallDir`""
}
if ($RemoveData) {
  Remove-Item -Recurse -Force (Join-Path $env:USERPROFILE '.agentviewer') -ErrorAction SilentlyContinue
  Write-Host '  설정·접속 코드 삭제'
}
Write-Host '  제거 완료' -ForegroundColor Green
