param(
  [string]$ConfigPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $scriptRoot 'corepos-dymo-product-label-agent.config.json'
}
$printScriptPath = Join-Path $scriptRoot 'print_product_label_windows.ps1'
$defaultOutputDir = Join-Path $scriptRoot 'output'
$defaultBindHost = '127.0.0.1'
$defaultPort = 3212

function Get-ConfigProperty {
  param(
    [object]$Config,
    [string]$Name
  )

  if ($null -eq $Config) {
    return $null
  }

  $property = $Config.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

function Read-AgentConfig {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  if ([string]::IsNullOrWhiteSpace($raw)) {
    throw "Config file '$Path' is empty."
  }

  return $raw | ConvertFrom-Json
}

function Resolve-PositiveInteger {
  param(
    [object]$Value,
    [int]$Fallback,
    [string]$Field
  )

  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
    return $Fallback
  }

  $parsed = 0
  if (-not [int]::TryParse([string]$Value, [ref]$parsed) -or $parsed -le 0) {
    throw "$Field must be a positive integer."
  }

  return $parsed
}

function Resolve-Boolean {
  param(
    [object]$Value,
    [bool]$Fallback
  )

  if ($null -eq $Value) {
    return $Fallback
  }

  if ($Value -is [bool]) {
    return [bool]$Value
  }

  $normalized = ([string]$Value).Trim().ToLowerInvariant()
  if ($normalized -eq 'true' -or $normalized -eq '1' -or $normalized -eq 'yes') {
    return $true
  }
  if ($normalized -eq 'false' -or $normalized -eq '0' -or $normalized -eq 'no') {
    return $false
  }

  return $Fallback
}

function Resolve-String {
  param(
    [object]$Value,
    [string]$Fallback = ''
  )

  if ($null -eq $Value) {
    return $Fallback
  }

  $text = ([string]$Value).Trim()
  if ([string]::IsNullOrWhiteSpace($text)) {
    return $Fallback
  }

  return $text
}

function Require-String {
  param(
    [object]$Value,
    [string]$Field
  )

  $text = Resolve-String -Value $Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    throw "$Field must be a non-empty string."
  }

  return $text
}

function Require-PositiveInteger {
  param(
    [object]$Value,
    [string]$Field
  )

  $parsed = 0
  if (-not [int]::TryParse([string]$Value, [ref]$parsed) -or $parsed -le 0) {
    throw "$Field must be a positive integer."
  }

  return $parsed
}

function Get-BodyText {
  param([System.Net.HttpListenerRequest]$Request)

  $reader = [System.IO.StreamReader]::new($Request.InputStream, $Request.ContentEncoding)
  try {
    return $reader.ReadToEnd()
  }
  finally {
    $reader.Dispose()
  }
}

function Write-JsonResponse {
  param(
    [System.Net.HttpListenerContext]$Context,
    [int]$StatusCode,
    [object]$Body
  )

  $response = $Context.Response
  $json = $Body | ConvertTo-Json -Depth 10 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $response.StatusCode = $StatusCode
  $response.ContentType = 'application/json; charset=utf-8'
  $response.ContentEncoding = [System.Text.Encoding]::UTF8
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.OutputStream.Close()
}

function Write-ErrorResponse {
  param(
    [System.Net.HttpListenerContext]$Context,
    [int]$StatusCode,
    [string]$Code,
    [string]$Message
  )

  Write-JsonResponse -Context $Context -StatusCode $StatusCode -Body @{
    error = @{
      code = $Code
      message = $Message
    }
  }
}

function New-IsoTimestamp {
  return [DateTimeOffset]::UtcNow.ToString('o')
}

function New-JobId {
  return 'product-label-job-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '-' + ([Guid]::NewGuid().ToString('N').Substring(0, 8))
}

function Decode-ProductLabelBytes {
  param([object]$Document)

  $format = Require-String -Value (Get-ConfigProperty -Config $Document -Name 'format') -Field 'printRequest.document.format'
  if ($format -ne 'PNG') {
    throw "printRequest.document.format must be PNG."
  }

  $mimeType = Require-String -Value (Get-ConfigProperty -Config $Document -Name 'mimeType') -Field 'printRequest.document.mimeType'
  if ($mimeType -ne 'image/png') {
    throw "printRequest.document.mimeType must be image/png."
  }

  $bytesBase64 = Require-String -Value (Get-ConfigProperty -Config $Document -Name 'bytesBase64') -Field 'printRequest.document.bytesBase64'
  try {
    $bytes = [Convert]::FromBase64String($bytesBase64)
  }
  catch {
    throw 'printRequest.document.bytesBase64 must be valid base64 PNG content.'
  }

  if ($bytes.Length -le 0) {
    throw 'printRequest.document.bytesBase64 decoded to empty content.'
  }

  return $bytes
}

function Validate-ProductLabelPrintRequest {
  param([object]$Body)

  $printRequest = Get-ConfigProperty -Config $Body -Name 'printRequest'
  if ($null -eq $printRequest) {
    throw 'body.printRequest is required.'
  }

  $intentType = Require-String -Value (Get-ConfigProperty -Config $printRequest -Name 'intentType') -Field 'printRequest.intentType'
  if ($intentType -ne 'PRODUCT_LABEL_PRINT') {
    throw 'printRequest.intentType must be PRODUCT_LABEL_PRINT.'
  }

  $printer = Get-ConfigProperty -Config $printRequest -Name 'printer'
  if ($null -eq $printer) {
    throw 'printRequest.printer is required.'
  }

  $transport = Require-String -Value (Get-ConfigProperty -Config $printer -Name 'transport') -Field 'printRequest.printer.transport'
  if ($transport -ne 'WINDOWS_LOCAL_AGENT') {
    throw 'printRequest.printer.transport must be WINDOWS_LOCAL_AGENT.'
  }

  $printerFamily = Require-String -Value (Get-ConfigProperty -Config $printer -Name 'printerFamily') -Field 'printRequest.printer.printerFamily'
  if ($printerFamily -ne 'DYMO_LABEL') {
    throw 'printRequest.printer.printerFamily must be DYMO_LABEL.'
  }

  $transportMode = Require-String -Value (Get-ConfigProperty -Config $printer -Name 'transportMode') -Field 'printRequest.printer.transportMode'
  if ($transportMode -ne 'DRY_RUN' -and $transportMode -ne 'WINDOWS_PRINTER') {
    throw 'printRequest.printer.transportMode must be DRY_RUN or WINDOWS_PRINTER.'
  }

  $printerName = Require-String -Value (Get-ConfigProperty -Config $printer -Name 'printerName') -Field 'printRequest.printer.printerName'
  $windowsPrinterName = Resolve-String -Value (Get-ConfigProperty -Config $printer -Name 'windowsPrinterName')
  if ($transportMode -eq 'WINDOWS_PRINTER' -and [string]::IsNullOrWhiteSpace($windowsPrinterName)) {
    throw 'printRequest.printer.windowsPrinterName is required for WINDOWS_PRINTER jobs.'
  }

  $document = Get-ConfigProperty -Config $printRequest -Name 'document'
  if ($null -eq $document) {
    throw 'printRequest.document is required.'
  }

  $fileName = Resolve-String -Value (Get-ConfigProperty -Config $document -Name 'fileName') -Fallback 'corepos-product-label.png'

  return @{
    printerId = Require-String -Value (Get-ConfigProperty -Config $printer -Name 'printerId') -Field 'printRequest.printer.printerId'
    printerKey = Require-String -Value (Get-ConfigProperty -Config $printer -Name 'printerKey') -Field 'printRequest.printer.printerKey'
    printerName = $printerName
    transportMode = $transportMode
    windowsPrinterName = $windowsPrinterName
    copies = Require-PositiveInteger -Value (Get-ConfigProperty -Config $printer -Name 'copies') -Field 'printRequest.printer.copies'
    fileName = $fileName
    documentBytes = Decode-ProductLabelBytes -Document $document
  }
}

function Invoke-WindowsPrinterJob {
  param(
    [string]$PrinterName,
    [string]$ImagePath,
    [int]$Copies
  )

  if (-not (Test-Path -LiteralPath $printScriptPath)) {
    throw "Required print helper '$printScriptPath' is missing."
  }

  & $printScriptPath -PrinterName $PrinterName -ImagePath $ImagePath -Copies $Copies -WidthMm 57 -HeightMm 32
}

function Write-ProductLabelDryRun {
  param(
    [byte[]]$DocumentBytes,
    [string]$FileName,
    [string]$OutputDir
  )

  $targetDir = Join-Path $OutputDir 'product-labels'
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  $targetPath = Join-Path $targetDir $FileName
  [System.IO.File]::WriteAllBytes($targetPath, $DocumentBytes)
  return $targetPath
}

function Invoke-ProductLabelJob {
  param(
    [hashtable]$Request,
    [string]$DryRunOutputDir
  )

  $acceptedAt = New-IsoTimestamp
  $jobId = New-JobId

  if ($Request.transportMode -eq 'DRY_RUN') {
    $outputPath = Write-ProductLabelDryRun -DocumentBytes $Request.documentBytes -FileName $Request.fileName -OutputDir $DryRunOutputDir
    return @{
      jobId = $jobId
      acceptedAt = $acceptedAt
      completedAt = New-IsoTimestamp
      transportMode = 'DRY_RUN'
      printerId = $Request.printerId
      printerKey = $Request.printerKey
      printerName = $Request.printerName
      printerTarget = "dry-run:$([System.IO.Path]::GetDirectoryName($outputPath))"
      copies = $Request.copies
      documentFormat = 'DYMO_PRODUCT_LABEL'
      bytesSent = $Request.documentBytes.Length
      simulated = $true
      outputPath = $outputPath
    }
  }

  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('corepos-dymo-agent-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $tempImagePath = Join-Path $tempDir $Request.fileName

  try {
    [System.IO.File]::WriteAllBytes($tempImagePath, $Request.documentBytes)
    Invoke-WindowsPrinterJob -PrinterName $Request.windowsPrinterName -ImagePath $tempImagePath -Copies $Request.copies
  }
  finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  return @{
    jobId = $jobId
    acceptedAt = $acceptedAt
    completedAt = New-IsoTimestamp
    transportMode = 'WINDOWS_PRINTER'
    printerId = $Request.printerId
    printerKey = $Request.printerKey
    printerName = $Request.printerName
    printerTarget = $Request.windowsPrinterName
    copies = $Request.copies
    documentFormat = 'DYMO_PRODUCT_LABEL'
    bytesSent = $Request.documentBytes.Length
    simulated = $false
    outputPath = $null
  }
}

$configObject = Read-AgentConfig -Path $ConfigPath
$bindHost = Resolve-String -Value (Get-ConfigProperty -Config $configObject -Name 'bindHost') -Fallback $defaultBindHost
$port = Resolve-PositiveInteger -Value (Get-ConfigProperty -Config $configObject -Name 'port') -Fallback $defaultPort -Field 'port'
$sharedSecret = Resolve-String -Value (Get-ConfigProperty -Config $configObject -Name 'sharedSecret')
$dryRunOutputDir = Resolve-String -Value (Get-ConfigProperty -Config $configObject -Name 'dryRunOutputDir') -Fallback $defaultOutputDir
$logRequests = Resolve-Boolean -Value (Get-ConfigProperty -Config $configObject -Name 'logRequests') -Fallback $true

$listener = [System.Net.HttpListener]::new()
$prefix = "http://$bindHost`:$port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "[corepos-dymo-agent] Listening on $prefix"
Write-Host "[corepos-dymo-agent] Using config $ConfigPath"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $path = $context.Request.Url.AbsolutePath
      $method = $context.Request.HttpMethod.ToUpperInvariant()

      if ($logRequests) {
        Write-Host "[corepos-dymo-agent] $method $path"
      }

      if ($method -eq 'GET' -and $path -eq '/health') {
        Write-JsonResponse -Context $context -StatusCode 200 -Body @{
          status = 'ok'
          supportedTransportModes = @('DRY_RUN', 'WINDOWS_PRINTER')
          supportedJobs = @{
            productLabels = @('DRY_RUN', 'WINDOWS_PRINTER')
          }
          bindHost = $bindHost
          port = $port
        }
        continue
      }

      if ($method -eq 'POST' -and $path -eq '/jobs/product-label') {
        $providedSecret = Resolve-String -Value $context.Request.Headers['X-CorePOS-Print-Agent-Secret']
        if (-not [string]::IsNullOrWhiteSpace($sharedSecret) -and $providedSecret -ne $sharedSecret) {
          Write-ErrorResponse -Context $context -StatusCode 401 -Code 'PRINT_AGENT_UNAUTHORIZED' -Message 'Print agent secret was missing or invalid'
          continue
        }

        $bodyText = Get-BodyText -Request $context.Request
        if ([string]::IsNullOrWhiteSpace($bodyText)) {
          Write-ErrorResponse -Context $context -StatusCode 400 -Code 'PRINT_AGENT_REQUEST_INVALID' -Message 'Request body was empty'
          continue
        }

        try {
          $body = $bodyText | ConvertFrom-Json
        }
        catch {
          Write-ErrorResponse -Context $context -StatusCode 400 -Code 'PRINT_AGENT_REQUEST_INVALID' -Message 'Request body was not valid JSON'
          continue
        }

        try {
          $validatedRequest = Validate-ProductLabelPrintRequest -Body $body
          $job = Invoke-ProductLabelJob -Request $validatedRequest -DryRunOutputDir $dryRunOutputDir
          Write-JsonResponse -Context $context -StatusCode 201 -Body @{ ok = $true; job = $job }
        }
        catch {
          Write-ErrorResponse -Context $context -StatusCode 400 -Code 'PRINT_AGENT_REQUEST_INVALID' -Message $_.Exception.Message
        }
        continue
      }

      Write-ErrorResponse -Context $context -StatusCode 404 -Code 'PRINT_AGENT_NOT_FOUND' -Message 'Unknown print-agent route'
    }
    catch {
      try {
        Write-ErrorResponse -Context $context -StatusCode 500 -Code 'PRINT_AGENT_INTERNAL_ERROR' -Message $_.Exception.Message
      }
      catch {
      }
    }
  }
}
finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
}
