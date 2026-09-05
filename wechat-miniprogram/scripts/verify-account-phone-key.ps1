param()
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$encryptedKeyPath = Join-Path $projectRoot ".cloudbase-cli-config\account-phone-key.dpapi"
if (-not (Test-Path -LiteralPath $encryptedKeyPath)) { throw "Local encrypted phone key is missing" }

$secure = Get-Content -Raw -LiteralPath $encryptedKeyPath | ConvertTo-SecureString
$credential = [System.Management.Automation.PSCredential]::new("account-phone", $secure)
$localKey = $credential.GetNetworkCredential().Password

$raw = (& node (Join-Path $PSScriptRoot "cloudbase-cli.js") fn detail account-bootstrap -e quest-band-d1gem4bxt3fa17720 --json 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "CloudBase function detail lookup failed" }
$jsonStart = $raw.IndexOf("{")
if ($jsonStart -lt 0) { throw "CloudBase function detail did not return JSON" }
$detail = ($raw.Substring($jsonStart) | ConvertFrom-Json)
$cloudKey = ($detail.data.Environment.Variables | Where-Object { $_.Key -eq "ACCOUNT_PHONE_HASH_KEY" } | Select-Object -First 1).Value
if (-not $cloudKey) { throw "Cloud phone key is missing" }
if ($cloudKey -cne $localKey) { throw "Cloud phone key does not match local DPAPI ciphertext" }
if ($cloudKey.Length -lt 32) { throw "Cloud phone key is too short" }

Write-Output "account-bootstrap phone fingerprint key verified: present, length valid, cloud/local match."
