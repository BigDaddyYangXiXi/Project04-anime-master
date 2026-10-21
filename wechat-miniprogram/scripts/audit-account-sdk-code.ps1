param([ValidateSet('account-api','account-bootstrap','catalog-read','availability-api','order-api')][string]$FunctionName='account-bootstrap')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$zip=$null
try {
  $body=@{FunctionName=$FunctionName;Namespace='cloudbase-d2g65rqbvee0bd978'}|ConvertTo-Json -Compress
  $raw=(& node (Join-Path $PSScriptRoot 'cloudbase-company-cli.js') api scf GetFunctionAddress --api-version 2018-04-16 --body $body --json 2>$null)-join "`n"
  if($LASTEXITCODE -ne 0){throw 'LOOKUP_FAILED'}
  $result=$raw.Substring($raw.IndexOf('{'),$raw.LastIndexOf('}')-$raw.IndexOf('{')+1)|ConvertFrom-Json
  $uri=[uri]$result.data.Url
  if($uri.Scheme -ne 'https'){throw 'INVALID_URL'}
  $archive=Join-Path $root ".artifacts/$FunctionName-sdk-deployed.zip"
  Invoke-WebRequest -Uri $uri -OutFile $archive|Out-Null
  if((Get-FileHash -LiteralPath $archive).Hash -ne $result.data.CodeSha256){throw 'ARCHIVE_MISMATCH'}
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($archive)
  $folder=Join-Path $root ".artifacts/account-sdk-functions/$FunctionName"
  $names=if($FunctionName -eq 'account-bootstrap'){
    @('index.js','identity-core.js','phone-core.js','account-names.js','nickname-security.js','wx-phone-adapter.js','request-context.js')
  }elseif($FunctionName -eq 'catalog-read'){@('index.js','catalog-core.js','nearby-cities.js')}
  elseif($FunctionName -eq 'availability-api'){@('index.js','availability-core.js','request-context.js')}
  elseif($FunctionName -eq 'order-api'){@(Get-ChildItem -LiteralPath $folder -File -Filter '*.js' | Where-Object { $_.Name -notlike '*.test.js' } | Select-Object -ExpandProperty Name)}
  else{@('index.js','account-core.js','request-context.js','nickname-security.js','location-resolver.js')}
  $names+=@('vendor/dist/utils/cloudbase.cjs','vendor/package.json')
  foreach($name in $names){
    $entry=$zip.GetEntry($name)
    if(!$entry){throw 'ENTRY_MISSING'}
    $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
    try{$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')}finally{$stream.Dispose();$sha.Dispose()}
    if($hash -ne (Get-FileHash -LiteralPath (Join-Path $folder $name)).Hash){throw 'FILE_MISMATCH'}
  }
  $report=@{checkedAt=[DateTime]::UtcNow.ToString('o');functionName=$FunctionName;verifiedFiles=$names;ok=$true}|ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $root ".artifacts/$FunctionName-sdk-code-audit.json"),$report)
  Write-Output $report
}catch{Write-Output 'ACCOUNT_SDK_CODE_AUDIT_FAILED';exit 1}finally{if($zip){$zip.Dispose()}}
