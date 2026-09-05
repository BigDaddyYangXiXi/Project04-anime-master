param([switch]$Rotate)
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$credentialDir = Join-Path $projectRoot ".cloudbase-cli-config"
$encryptedKeyPath = Join-Path $credentialDir "account-phone-key.dpapi"
New-Item -ItemType Directory -Force -Path $credentialDir | Out-Null

if ((Test-Path -LiteralPath $encryptedKeyPath) -and -not $Rotate) {
  $secure = Get-Content -Raw -LiteralPath $encryptedKeyPath | ConvertTo-SecureString
  $credential = [System.Management.Automation.PSCredential]::new("account-phone", $secure)
  $phoneKey = $credential.GetNetworkCredential().Password
} else {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $phoneKey = [Convert]::ToBase64String($bytes)
  ConvertTo-SecureString $phoneKey -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -NoNewline -LiteralPath $encryptedKeyPath
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempDir = Join-Path $tempRoot ("anime-master-phone-config-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
  $config = @{
    '$schema' = "https://static.cloudbase.net/cli/cloudbaserc.schema.json"
    envId = "quest-band-d1gem4bxt3fa17720"
    functionRoot = (Join-Path $projectRoot "cloudfunctions")
    functions = @(@{
      name = "account-bootstrap"
      runtime = "Nodejs20.19"
      handler = "index.main"
      timeout = 15
      description = "Anime Master official WeChat and phone account entry"
      envVariables = @{ ACCOUNT_PHONE_HASH_KEY = $phoneKey }
    })
  }
  [IO.File]::WriteAllText((Join-Path $tempDir "cloudbaserc.json"), ($config | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
  Push-Location $tempDir
  try {
    "" | & node (Join-Path $PSScriptRoot "cloudbase-cli.js") config update fn account-bootstrap
    if ($LASTEXITCODE -ne 0) { throw "CloudBase account-bootstrap configuration update failed" }
  } finally {
    Pop-Location
  }
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempDir)
  if ($resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}

Write-Output "account-bootstrap phone fingerprint key update submitted; run verify-account-phone-key.ps1 before treating it as configured."
