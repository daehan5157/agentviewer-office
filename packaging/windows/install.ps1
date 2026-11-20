# Agentviewer 설치 (Windows, 관리자 권한 필요 없음)
#  - 이 폴더의 앱과 Node 런타임을 %LOCALAPPDATA%\Agentviewer 로 복사
#  - 로그온할 때 백그라운드로 켜지는 작업 등록 ("Agentviewer")
#  - 바탕화면·시작 메뉴에 "Agentviewer" 바로가기 (브라우저로 http://localhost:4747 열기)
# 대시보드는 이 PC에서만 열려요.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Agentviewer'),
  [int]$Port = 4747,
  [int]$WindowMinutes = 480,
  [string]$TaskName = 'Agentviewer',
  [switch]$NoTask,     # 로그온 자동 실행 등록 안 함
  [switch]$NoShortcut, # 바로가기 안 만듦
  [switch]$NoOpen      # 설치 후 브라우저 안 열기
)
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot

function Say($m) { Write-Host "  $m" }
Write-Host ''
Write-Host 'Agentviewer 설치' -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $src 'node\node.exe')) -or -not (Test-Path (Join-Path $src 'app\bin\agentviewer.js'))) {
  throw '설치 파일이 빠져 있어요. 받은 zip을 통째로 압축 해제한 폴더에서 실행해 주세요.'
}

# a running copy holds node.exe: stop it first (only ours, by its path)
$nodeDst = Join-Path $InstallDir 'node\node.exe'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $nodeDst) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
foreach ($d in 'app', 'node') {
  $to = Join-Path $InstallDir $d
  if (Test-Path $to) { Remove-Item -Recurse -Force $to }
  Copy-Item -Recurse -Force (Join-Path $src $d) $to
}
Copy-Item -Force (Join-Path $src 'uninstall.ps1') (Join-Path $InstallDir 'uninstall.ps1')
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null
Say "설치 위치: $InstallDir"

# the launcher the logon task (and the shortcut) runs
$start = @"
# Agentviewer 시작 (설치 프로그램이 만든 파일). 포트 $Port 가 이미 쓰이고 있으면 아무것도 안 함.
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { exit 0 }
`$dir = `$PSScriptRoot
Start-Process -FilePath (Join-Path `$dir 'node\node.exe') ``
  -ArgumentList '--no-deprecation', 'bin\agentviewer.js', '--port', '$Port', '--window', '$WindowMinutes' ``
  -WorkingDirectory (Join-Path `$dir 'app') ``
  -WindowStyle Hidden ``
  -RedirectStandardOutput (Join-Path `$dir 'logs\server.log') ``
  -RedirectStandardError (Join-Path `$dir 'logs\server-error.log')
"@
$startPath = Join-Path $InstallDir 'start.ps1'
[IO.File]::WriteAllText($startPath, $start, (New-Object Text.UTF8Encoding $true))
@{ port = $Port; taskName = $TaskName; startScript = $startPath } | ConvertTo-Json | Set-Content -Encoding ASCII (Join-Path $InstallDir 'install.json')

$psArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startPath`""
if (-not $NoTask) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Agentviewer: 이 PC의 AI 에이전트 대시보드 (로그온 시 시작)' -Force | Out-Null
  Say "로그온 자동 실행 등록: 작업 스케줄러 '$TaskName'"
}

$url = "http://localhost:$Port/"
if (-not $NoShortcut) {
  $body = "[InternetShortcut]`r`nURL=$url`r`n"
  foreach ($dir in [Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) '')) {
    [IO.File]::WriteAllText((Join-Path $dir 'Agentviewer.url'), $body, [Text.Encoding]::ASCII)
  }
  Say '바로가기: 바탕화면, 시작 메뉴 "Agentviewer"'
}

# start now
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Say "포트 $Port 를 이미 다른 프로그램이 쓰고 있어요. -Port 로 다른 번호를 지정해 다시 설치하세요."
} else {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startPath
  $ok = $false
  for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
    Start-Sleep -Milliseconds 500
    $ok = [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  }
  if ($ok) { Say "실행 중: $url" } else { Say "시작하지 못했어요. 로그를 확인하세요: $(Join-Path $InstallDir 'logs\server-error.log')" }
}
if (-not $NoOpen) { Start-Process $url }
Write-Host ''
Write-Host '설치 완료. 지우려면 Uninstall.cmd (또는 설치 폴더의 uninstall.ps1)' -ForegroundColor Green
