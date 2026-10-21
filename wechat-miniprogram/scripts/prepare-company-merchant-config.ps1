param(
  [Parameter(Mandatory=$true)][string]$CertificateZip,
  [Parameter(Mandatory=$true)][string]$PublicKeyPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^PUB_KEY_ID_[0-9]{1,100}$')][string]$PublicKeyId
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $projectRoot
$privateDir = Join-Path $projectRoot '.cloudbase-cli-config'
$destination = Join-Path $privateDir 'merchant-configured-closed'
$archive = $null
$rsa = $null
try {
  $inspection = (& (Join-Path $PSScriptRoot 'inspect-payment-certificate.ps1') -ZipPath $CertificateZip -MerchantId '1750932981') | ConvertFrom-Json
  if (-not $inspection.valid) { throw 'Invalid certificate' }
  if (Test-Path -LiteralPath $destination) { throw 'Existing configured material requires review' }
  & git -c "safe.directory=$workspaceRoot" -C $projectRoot check-ignore --quiet ($destination + '/payment-api.json')
  if ($LASTEXITCODE -ne 0) { throw 'Destination must be ignored' }
  $publicPem = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $PublicKeyPath).Path)
  if (-not $publicPem.StartsWith('-----BEGIN PUBLIC KEY-----') -or $publicPem.Length -gt 8192) { throw 'Invalid public key' }
  $rsa = [Security.Cryptography.RSA]::Create()
  $rsa.ImportFromPem($publicPem)
  if ($rsa.KeySize -ne 2048) { throw 'Invalid key size' }
  $secure = Get-Content -Raw -LiteralPath (Join-Path $privateDir 'payment-api-v3-1750932981.dpapi') | ConvertTo-SecureString
  $apiKey = [Management.Automation.PSCredential]::new('payment', $secure).GetNetworkCredential().Password
  if ($apiKey -cnotmatch '^[A-Za-z0-9]{32}$') { throw 'Invalid API key' }
  $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $CertificateZip).Path)
  $reader = [IO.StreamReader]::new($archive.GetEntry('apiclient_key.pem').Open())
  try { $privatePem = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $rsa.ImportFromPem($privatePem)
  $merchantPublicPem = $rsa.ExportSubjectPublicKeyInfoPem()
  $notifyUrl = 'https://cloudbase-d2g65rqbvee0bd978-1494174688.ap-shanghai.app.tcloudbase.com/wechat-payment-notify'
  $prepared = @{}
  foreach ($name in @('payment-api','payment-notify','payment-query-relay','payment-mutation-relay','payment-mutation-guard')) {
    $sourceName = switch ($name) {
      'payment-api' { 'company-payment-closed-deploy.json' }
      'payment-notify' { 'company-payment-notify-closed-deploy.json' }
      default { $name + '-closed-deploy.json' }
    }
    $deployment = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $privateDir $sourceName) | ConvertFrom-Json -AsHashtable
    if ($deployment.envId -cne 'cloudbase-d2g65rqbvee0bd978' -or $deployment.functions.Count -ne 1 -or $deployment.functions[0].name -cne $name) { throw 'Wrong deployment target' }
    $vars = $deployment.functions[0].envVariables
    $envKey = if ($name -in @('payment-api','payment-notify')) { 'PAYMENT_WECHAT_CONFIG_B64' } else { 'PAYMENT_' + $name.Substring(8).Replace('-','_').ToUpperInvariant() + '_CONFIG_B64' }
    $config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($vars[$envKey])) | ConvertFrom-Json -AsHashtable
    foreach ($flag in @('enabled','mutationsEnabled','prepayEnabled','closeEnabled','settlementEnabled','settlementExecutionEnabled','settlementPreparationEnabled','reconciliationEnabled')) {
      if ($config.ContainsKey($flag) -and $config[$flag] -ne $false) { throw 'Source must be closed' }
    }
    $config.platformMchid='1750932981'; $config.merchantSerial=$inspection.merchantSerial
    $config.wechatPublicKeyId=$PublicKeyId; $config.appid='wxc94e1c1b38944511'; $config.notifyUrl=$notifyUrl
    if ($name -in @('payment-api','payment-notify')) {
      if ($config.paymentMode -cne 'DIRECT') { throw 'Direct mode required' }
      $config.merchantPrivateKey=$privatePem; $config.apiV3Key=$apiKey
      $config.publicKeys=@{}; $config.publicKeys[$PublicKeyId]=$publicPem
      $config.queryRelay=$true; $config.mutationRelay=$true
    } else { $config.merchantPublicKey=$merchantPublicPem }
    $vars[$envKey]=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($config | ConvertTo-Json -Depth 20 -Compress)))
    $prepared[$name]=($deployment | ConvertTo-Json -Depth 30)
  }
  # Restrict a new, ignored directory before writing any plaintext deployment credentials.
  [IO.Directory]::CreateDirectory($destination) | Out-Null
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  }
  Set-Acl -LiteralPath $destination -AclObject $acl
  foreach ($name in $prepared.Keys) {
    [IO.File]::WriteAllText((Join-Path $destination ($name + '.json')), $prepared[$name], [Text.UTF8Encoding]::new($false))
  }
  @{prepared=$true; functions=$prepared.Count; merchantId='1750932981'; accessRestricted=$true;
    moneyActionsEnabled=$false; deployed=$false} | ConvertTo-Json -Compress
} catch {
  @{prepared=$false; code='MERCHANT_CONFIG_PREPARATION_FAILED'} | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($archive) { $archive.Dispose() }
  if ($rsa) { $rsa.Dispose() }
  if ($prepared) { $prepared.Clear() }
  $privatePem=$null; $apiKey=$null
}
