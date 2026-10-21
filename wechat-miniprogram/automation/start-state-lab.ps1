$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskPort = Get-NetTCPConnection -LocalPort 9433 -State Listen -ErrorAction SilentlyContinue
if ($taskPort) { Write-Output '测试场景台已运行：http://127.0.0.1:9433'; exit 0 }
$taskNode = (Get-Command node).Source
$taskOutput = Join-Path $taskRoot '.artifacts'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
Start-Process -FilePath $taskNode -ArgumentList 'state-lab.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskOutput 'state-lab-server.log') -RedirectStandardError (Join-Path $taskOutput 'state-lab-server.err')
Write-Output '测试场景台已启动：http://127.0.0.1:9433。需要微信开发者工具自动化连接 9422 可用。'
