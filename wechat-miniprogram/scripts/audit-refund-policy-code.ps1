#requires -Version 7.3
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content -LiteralPath (Join-Path $root '.artifacts/refund-policy-deploy-manifest.json') -Raw | ConvertFrom-Json
$results = @()
$stage = 'LOOKUP'
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
  foreach ($name in @('order-api', 'payment-api')) {
    $stage = "$name LOOKUP"
    $request = @{ FunctionName = $name; Namespace = 'cloudbase-d2g65rqbvee0bd978' } | ConvertTo-Json -Compress
    $ErrorActionPreference = 'Continue'
    $raw = (& node (Join-Path $PSScriptRoot 'cloudbase-company-cli.js') api scf GetFunctionAddress --api-version 2018-04-16 --body $request --json 2>$null) -join "`n"
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw 'LOOKUP_FAILED' }
    $response = $raw.Substring($raw.IndexOf('{'), $raw.LastIndexOf('}') - $raw.IndexOf('{') + 1) | ConvertFrom-Json
    $address = [uri]$response.data.Url
    if ($address.Scheme -ne 'https' -or $response.data.CodeSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'INVALID_ADDRESS' }
    # Signed URLs and function environment values are never printed or saved.
    $archive = Join-Path $root ".artifacts/refund-policy-$name-deployed.zip"
    $stage = "$name DOWNLOAD"
    Invoke-WebRequest -Uri $address -OutFile $archive | Out-Null
    $digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($digest -ne $response.data.CodeSha256.ToLowerInvariant()) { throw 'ARCHIVE_HASH_MISMATCH' }
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    $stage = "$name COMPARE"
    try {
      $expected = @($manifest.files | Where-Object { ($_.file.StartsWith('order-api/')) -eq ($name -eq 'order-api') })
      if ($expected.Count -ne $(if ($name -eq 'order-api') { 2 } else { 3 })) { throw 'MANIFEST_SCOPE_MISMATCH' }
      foreach ($file in $expected) {
        $entryName = $file.file -replace '^order-api/', ''
        $entries = @($zip.Entries | Where-Object { $_.FullName -ceq $entryName })
        if ($entries.Count -ne 1) { throw 'ENTRY_MISSING_OR_DUPLICATED' }
        $stream = $entries[0].Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($hash -ne $file.sha256) { throw 'DEPLOYED_SOURCE_MISMATCH' }
        $results += @{ functionName = $name; file = $entryName; sha256 = $hash; matches = $true }
      }
    } finally { $zip.Dispose() }
  }
  $report = @{ checkedAt = [DateTime]::UtcNow.ToString('o'); ok = $true; files = $results; scope = 'Five refund policy files match deployment manifest; not full dependency or authenticated runtime verification.' } | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText((Join-Path $root '.artifacts/refund-policy-code-audit.json'), $report)
  Write-Output $report
} catch { Write-Error "REFUND_POLICY_CODE_AUDIT_FAILED stage=$stage"; exit 1 }
