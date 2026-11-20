# Builds dist\Agentviewer-windows-x64.zip: the app, a Node runtime, and the installer.
# Colleagues unzip it and double-click Install.cmd — no Node.js or admin rights needed.
#   powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 [-Node <path to node.exe>]
param([string]$Node = (Get-Command node -ErrorAction Stop).Source)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$here = $PSScriptRoot
$version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $repo 'dist'
$stage = Join-Path $dist 'Agentviewer'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'app'), (Join-Path $stage 'node') | Out-Null

# the app: only what runs (no tests, no git)
foreach ($p in 'bin', 'src', 'public', 'docs', 'package.json', 'README.md') { Copy-Item -Recurse (Join-Path $repo $p) (Join-Path $stage 'app') }

# Node runtime + its license
Copy-Item $Node (Join-Path $stage 'node\node.exe')
$lic = Join-Path (Split-Path $Node) 'LICENSE'
if (Test-Path $lic) { Copy-Item $lic (Join-Path $stage 'node\LICENSE') }
$nodeVer = & $Node --version

# installer files: Windows PowerShell 5.1 reads BOM-less scripts as the ANSI code page (Korean text breaks),
# so .ps1/.txt get a UTF-8 BOM; .cmd stay ASCII with CRLF
$bom = New-Object Text.UTF8Encoding $true
# (this script stays ASCII-only for the same reason: the readme is picked up as *.txt)
foreach ($f in @('install.ps1', 'uninstall.ps1') + @(Get-ChildItem $here -Filter *.txt | ForEach-Object Name)) {
  $t = [IO.File]::ReadAllText((Join-Path $here $f), [Text.Encoding]::UTF8) -replace "`r?`n", "`r`n"
  [IO.File]::WriteAllText((Join-Path $stage $f), $t, $bom)
}
foreach ($f in 'Install.cmd', 'Uninstall.cmd') {
  $t = [IO.File]::ReadAllText((Join-Path $here $f)) -replace "`r?`n", "`r`n"
  [IO.File]::WriteAllText((Join-Path $stage $f), $t, [Text.Encoding]::ASCII)
}

$zip = Join-Path $dist "Agentviewer-$version-windows-x64.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Built: $zip ($mb MB, Node $nodeVer)"
