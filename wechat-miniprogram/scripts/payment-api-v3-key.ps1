param(
  [ValidateSet('Initialize','Status','Copy')][string]$Action = 'Status',
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9]{1,32}$')][string]$MerchantId
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ((Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot 'cloudbaserc.json') | ConvertFrom-Json).envId -ne 'cloudbase-d2g65rqbvee0bd978') {
  throw 'Company environment mismatch'
}
$keyPath = Join-Path $projectRoot ('.cloudbase-cli-config/payment-api-v3-' + $MerchantId + '.dpapi')
$workspaceRoot = Split-Path -Parent $projectRoot
& git -c "safe.directory=$workspaceRoot" -C $projectRoot check-ignore --quiet $keyPath
if ($LASTEXITCODE -ne 0) { throw 'Payment key path must be ignored by Git' }
if (-not (Test-Path -LiteralPath $keyPath)) {
  if ($Action -ne 'Initialize') { throw 'Local payment key has not been initialized' }
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $chars = New-Object System.Text.StringBuilder
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 64
  try {
    while ($chars.Length -lt 32) {
      $rng.GetBytes($bytes)
      foreach ($value in $bytes) {
        if ($value -lt 248 -and $chars.Length -lt 32) { [void]$chars.Append($alphabet[$value % 62]) }
      }
    }
  } finally { $rng.Dispose(); [Array]::Clear($bytes, 0, $bytes.Length) }
  $encrypted = ConvertFrom-SecureString (ConvertTo-SecureString $chars.ToString() -AsPlainText -Force)
  $file = [IO.File]::Open($keyPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $encoded = [Text.Encoding]::UTF8.GetBytes($encrypted)
    $file.Write($encoded, 0, $encoded.Length)
  } finally { $file.Dispose(); $chars.Clear() | Out-Null }
}
$secure = Get-Content -Raw -LiteralPath $keyPath | ConvertTo-SecureString
$credential = [System.Management.Automation.PSCredential]::new('payment-api-v3', $secure)
$keyValue = $credential.GetNetworkCredential().Password
if ($keyValue -cnotmatch '^[A-Za-z0-9]{32}$') { throw 'Local payment key format invalid' }
if ($Action -eq 'Copy') { Set-Clipboard -Value $keyValue }
$keyValue = $null
@{ localKeyReady=$true; merchantId=$MerchantId; encryptedForCurrentWindowsUser=$true;
   copiedToClipboard=($Action -eq 'Copy'); merchantPlatformConfigured=$false } | ConvertTo-Json -Compress
