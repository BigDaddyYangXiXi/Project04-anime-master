param([ValidateSet('private', 'public')][string]$Side = 'private')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$functionName = "order-notification-$Side"
$archive = Join-Path $projectRoot ".artifacts/$functionName-deployed.zip"
$folder = Join-Path $projectRoot ".artifacts/company-notification-functions/$functionName"
$zip = $null
try {
  $request = @{ FunctionName = $functionName; Namespace = 'cloudbase-d2g65rqbvee0bd978' } | ConvertTo-Json -Compress
  $raw = (& node (Join-Path $PSScriptRoot 'cloudbase-company-cli.js') api scf GetFunctionAddress --api-version 2018-04-16 --body $request --json 2>$null) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'LOOKUP_FAILED' }
  $response = $raw.Substring($raw.IndexOf('{'), $raw.LastIndexOf('}') - $raw.IndexOf('{') + 1) | ConvertFrom-Json
  $address = [uri]$response.data.Url
  if ($address.Scheme -ne 'https' -or $response.data.CodeSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'INVALID_CODE_ADDRESS' }
  # Never log or persist the signed URL; only retain the code archive and digest.
  Invoke-WebRequest -Uri $address -OutFile $archive | Out-Null
  $digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($digest -ne $response.data.CodeSha256.ToLowerInvariant()) { throw 'ARCHIVE_HASH_MISMATCH' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $differences = [Collections.Generic.List[string]]::new()
  $compared = 0
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName.EndsWith('/')) { continue }
    $name = $entry.FullName
    if ($name.StartsWith('/') -or $name.Contains('\') -or $name.Contains(':') -or ($name.Split('/') -contains '..') -or !$seen.Add($name)) { throw 'INVALID_ARCHIVE_ENTRY' }
    $local = Join-Path $folder $name
    if (!(Test-Path -LiteralPath $local -PathType Leaf)) { $differences.Add("cloud-only:$name"); continue }
    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $entryHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
    if ($entryHash -ne (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash) { $differences.Add("changed:$name") }
    $compared++
  }
  $resolved = (Resolve-Path -LiteralPath $folder).Path
  foreach ($file in Get-ChildItem -LiteralPath $folder -File -Recurse) {
    $name = $file.FullName.Substring($resolved.Length + 1).Replace('\', '/')
    if (!$seen.Contains($name)) { $differences.Add("local-only:$name") }
  }
  $report = @{ ok = $differences.Count -eq 0 -and $compared -gt 0; checkedAt = [DateTime]::UtcNow.ToString('o'); functionName = $functionName;
    archiveSha256 = $digest; archiveBytes = (Get-Item -LiteralPath $archive).Length; comparedFiles = $compared;
    differences = @($differences.ToArray()); scope = 'Downloaded current cloud code versus local staging, including dependencies; no business invocation or write.' }
  $json = $report | ConvertTo-Json -Depth 4
  [IO.File]::WriteAllText((Join-Path $projectRoot ".artifacts/$functionName-code-audit.json"), $json)
  Write-Output $json
  if (!$report.ok) { exit 1 }
} catch { Write-Error 'NOTIFICATION_CODE_AUDIT_FAILED'; exit 1 }
finally { if ($null -ne $zip) { $zip.Dispose() } }
