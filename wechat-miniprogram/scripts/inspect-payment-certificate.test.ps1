$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$folder = Join-Path $PSScriptRoot '../.artifacts/payment-certificate-validation'
[IO.Directory]::CreateDirectory($folder) | Out-Null
$zipPath = Join-Path $folder ([Guid]::NewGuid().ToString('N') + '.zip')
$key = [Security.Cryptography.RSA]::Create(2048)
$wrongKey = [Security.Cryptography.RSA]::Create(2048)
$request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=1750932981', $key,
  [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
$valid = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1), [DateTimeOffset]::UtcNow.AddDays(1))
$expired = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-3), [DateTimeOffset]::UtcNow.AddDays(-2))
$future = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(1), [DateTimeOffset]::UtcNow.AddDays(2))
$passed = 0
try {
  $cases = @(
    @{cert=$valid.ExportCertificatePem(); key=$key.ExportPkcs8PrivateKeyPem(); merchant='1750932981'; code=$null},
    @{cert=$valid.ExportCertificatePem(); key=$key.ExportPkcs8PrivateKeyPem(); merchant='1750932982'; code='CERTIFICATE_MERCHANT_MISMATCH'},
    @{cert=$valid.ExportCertificatePem(); key=$wrongKey.ExportPkcs8PrivateKeyPem(); merchant='1750932981'; code='CERTIFICATE_OR_PRIVATE_KEY_INVALID'},
    @{cert=$expired.ExportCertificatePem(); key=$key.ExportPkcs8PrivateKeyPem(); merchant='1750932981'; code='CERTIFICATE_NOT_CURRENT'},
    @{cert=$future.ExportCertificatePem(); key=$key.ExportPkcs8PrivateKeyPem(); merchant='1750932981'; code='CERTIFICATE_NOT_CURRENT'},
    @{cert='malformed-test-certificate'; key=$key.ExportPkcs8PrivateKeyPem(); merchant='1750932981'; code='CERTIFICATE_OR_PRIVATE_KEY_INVALID'}
  )
  foreach ($case in $cases) {
    $archive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
    try {
      foreach ($entry in @(@{name='apiclient_cert.pem'; value=$case.cert}, @{name='apiclient_key.pem'; value=$case.key})) {
        $writer = [IO.StreamWriter]::new($archive.CreateEntry($entry.name).Open())
        try { $writer.Write($entry.value) } finally { $writer.Dispose() }
      }
    } finally { $archive.Dispose() }
    try {
      $raw = & (Join-Path $PSScriptRoot 'inspect-payment-certificate.ps1') -ZipPath $zipPath -MerchantId $case.merchant
      $result = $raw | ConvertFrom-Json
      if ($case.code) {
        if ($result.valid -ne $false -or $result.code -cne $case.code) { throw 'Expected rejection not observed' }
      } elseif ($result.valid -ne $true -or $result.privateKeyMatches -ne $true -or $result.issuerTrustVerified -ne $false) {
        throw 'Expected local-only validation not observed'
      }
      if ($raw -match 'BEGIN|malformed-test-certificate') { throw 'Secret or raw error leaked' }
      $passed++
    } finally { [IO.File]::Delete($zipPath) }
  }
  @{passed=$passed; testOnlyCertificates=$true; privateFixturesRemoved=(-not [IO.File]::Exists($zipPath))} | ConvertTo-Json -Compress
} finally {
  if ([IO.File]::Exists($zipPath)) { [IO.File]::Delete($zipPath) }
  $valid.Dispose(); $expired.Dispose(); $future.Dispose(); $key.Dispose(); $wrongKey.Dispose()
}
