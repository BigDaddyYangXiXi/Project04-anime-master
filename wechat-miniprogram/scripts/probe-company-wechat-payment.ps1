param(
  [Parameter(Mandatory=$true)][string]$CertificateZip,
  [Parameter(Mandatory=$true)][string]$PublicKeyPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^PUB_KEY_ID_[0-9]{1,100}$')][string]$PublicKeyId,
  [switch]$CloudRelay,
  [switch]$GuardOnly,
  [switch]$Refund
)
$ErrorActionPreference = 'Stop'
$archive = $null
$process = $null
$publicKey = $null
try {
  if ($CloudRelay -and $GuardOnly) { throw 'Select one probe route' }
  if ($Refund -and $GuardOnly) { throw 'Refund probe is read-only' }
  $inspection = (& (Join-Path $PSScriptRoot 'inspect-payment-certificate.ps1') -ZipPath $CertificateZip -MerchantId '1750932981') | ConvertFrom-Json
  if (-not $inspection.valid) { throw 'Certificate invalid' }
  $pem = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $PublicKeyPath).Path)
  if (-not $pem.StartsWith('-----BEGIN PUBLIC KEY-----') -or $pem.Length -gt 8192) { throw 'Public key invalid' }
  $publicKey = [Security.Cryptography.RSA]::Create()
  $publicKey.ImportFromPem($pem)
  if ($publicKey.KeySize -ne 2048) { throw 'Public key size invalid' }
  $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $CertificateZip).Path)
  $reader = [IO.StreamReader]::new($archive.GetEntry('apiclient_key.pem').Open())
  try { $privatePem = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $config = @{platformMchid='1750932981'; merchantSerial=$inspection.merchantSerial;
    merchantPrivateKey=$privatePem; wechatPublicKeyId=$PublicKeyId; wechatPublicKey=$pem}
  $start = [Diagnostics.ProcessStartInfo]::new((Get-Command node).Source)
  $probeScript = if ($GuardOnly) { 'probe-company-payment-guard.js' } else { 'probe-company-wechat-payment.js' }
  $start.ArgumentList.Add((Join-Path $PSScriptRoot $probeScript))
  if ($CloudRelay) { $start.ArgumentList.Add('--cloud-relay') }
  if ($Refund) { $start.ArgumentList.Add('--refund') }
  $start.UseShellExecute=$false; $start.CreateNoWindow=$true
  $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
  $process = [Diagnostics.Process]::Start($start)
  $process.StandardInput.Write(($config | ConvertTo-Json -Compress))
  $process.StandardInput.Close()
  $outputTask = $process.StandardOutput.ReadToEndAsync()
  $errorTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(20000)) { $process.Kill(); throw 'Probe timed out' }
  $result = $outputTask.GetAwaiter().GetResult() | ConvertFrom-Json
  # Output the probe's fixed, non-sensitive result only. Never relay process stderr.
  $result | Select-Object ok,checkedAt,transport,status,responseSignatureVerified,merchantQueryAccepted,code,unverifiedErrorCode,unverifiedMessage,signatureHeaderPresent,paymentCreated,apiV3DecryptionVerified,appidBindingVerified,firstConsumed,duplicateRejected,replayRecordsAdded,wechatMutationSubmitted | ConvertTo-Json -Compress
  if ($process.ExitCode -ne 0) { exit 1 }
} catch {
  @{ok=$false; code='PAYMENT_PROBE_PREPARATION_FAILED'} | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($archive) { $archive.Dispose() }
  if ($publicKey) { $publicKey.Dispose() }
  if ($process) { $process.Dispose() }
  if ($config) { $config.Clear() }
  $privatePem=$null
}
