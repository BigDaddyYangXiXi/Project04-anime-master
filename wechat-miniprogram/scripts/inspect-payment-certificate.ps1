param(
  [Parameter(Mandatory=$true)][string]$ZipPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9]{1,32}$')][string]$MerchantId
)
# Read the user-supplied archive in memory. Never extract or print the private key.
$ErrorActionPreference = 'Stop'
$archive = $null
$certificate = $null
$privateKey = $null
$failure = 'CERTIFICATE_ARCHIVE_INVALID'
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ZipPath).Path)
  $contents = @{}
  foreach ($name in @('apiclient_cert.pem', 'apiclient_key.pem')) {
    $entries = @($archive.Entries | Where-Object { $_.FullName -ceq $name })
    if ($entries.Count -ne 1 -or $entries[0].Length -gt 65536) { throw 'Invalid entry' }
    $reader = [IO.StreamReader]::new($entries[0].Open())
    try { $contents[$name] = $reader.ReadToEnd() } finally { $reader.Dispose() }
  }
  $failure = 'CERTIFICATE_OR_PRIVATE_KEY_INVALID'
  $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem(
    $contents['apiclient_cert.pem'], $contents['apiclient_key.pem'])
  $privateKey = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
  if (-not $privateKey -or $privateKey.KeySize -ne 2048) { throw 'RSA size invalid' }
  $failure = 'CERTIFICATE_MERCHANT_MISMATCH'
  if ($certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -cne $MerchantId) {
    throw 'Merchant mismatch'
  }
  $failure = 'CERTIFICATE_NOT_CURRENT'
  $now = [DateTime]::UtcNow
  if ($now -lt $certificate.NotBefore.ToUniversalTime() -or $now -ge $certificate.NotAfter.ToUniversalTime()) { throw 'Invalid dates' }
  @{ valid=$true; merchantId=$MerchantId; merchantMatches=$true; privateKeyMatches=$true;
    rsaBits=$privateKey.KeySize; merchantSerial=$certificate.SerialNumber;
    expiresAt=$certificate.NotAfter.ToUniversalTime().ToString('o');
    issuerTrustVerified=$false; merchantPlatformStatusVerified=$false;
    credentialsExtracted=$false; paymentEnabled=$false } | ConvertTo-Json -Compress
} catch {
  @{ valid=$false; code=$failure } | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($privateKey) { $privateKey.Dispose() }
  if ($certificate) { $certificate.Dispose() }
  if ($archive) { $archive.Dispose() }
  if ($contents) { $contents.Clear() }
}
