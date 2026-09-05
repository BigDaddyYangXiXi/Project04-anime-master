$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$credentialDir = Join-Path $projectRoot ".cloudbase-cli-config"
$encryptedKeyPath = Join-Path $credentialDir "order-contact-key.dpapi"
New-Item -ItemType Directory -Force -Path $credentialDir | Out-Null

if (Test-Path -LiteralPath $encryptedKeyPath) {
  $secure = Get-Content -Raw -LiteralPath $encryptedKeyPath | ConvertTo-SecureString
  $credential = [System.Management.Automation.PSCredential]::new("order-contact", $secure)
  $orderKey = $credential.GetNetworkCredential().Password
} else {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $orderKey = [Convert]::ToBase64String($bytes)
  ConvertTo-SecureString $orderKey -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -NoNewline -LiteralPath $encryptedKeyPath
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempDir = Join-Path $tempRoot ("anime-master-order-config-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
  $config = @{
    '$schema' = "https://static.cloudbase.net/cli/cloudbaserc.schema.json"
    envId = "quest-band-d1gem4bxt3fa17720"
    functionRoot = (Join-Path $projectRoot "cloudfunctions")
    functions = @(@{
      name = "order-api"
      runtime = "Nodejs20.19"
      handler = "index.main"
      timeout = 15
      description = "Anime Master atomic order aggregate API"
      envVariables = @{ ORDER_CONTACT_ENCRYPTION_KEY = $orderKey }
    })
  }
  $configJson = $config | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText((Join-Path $tempDir "cloudbaserc.json"), $configJson, [Text.UTF8Encoding]::new($false))
  Push-Location $tempDir
  try {
    & node (Join-Path $PSScriptRoot "cloudbase-cli.js") config update fn order-api
    if ($LASTEXITCODE -ne 0) { throw "CloudBase order-api configuration update failed" }
  } finally {
    Pop-Location
  }
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempDir)
  if ($resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}

Write-Output "order-api contact encryption key configured; only DPAPI ciphertext is stored locally."
