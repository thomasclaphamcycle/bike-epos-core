param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterName,
  [Parameter(Mandatory = $true)]
  [string]$ImagePath,
  [Parameter(Mandatory = $true)]
  [int]$Copies,
  [Parameter(Mandatory = $true)]
  [double]$WidthMm,
  [Parameter(Mandatory = $true)]
  [double]$HeightMm
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ImagePath)) {
  throw "Image path '$ImagePath' does not exist."
}

Add-Type -AssemblyName System.Drawing

$image = [System.Drawing.Image]::FromFile($ImagePath)
$document = New-Object System.Drawing.Printing.PrintDocument

try {
  $document.PrinterSettings.PrinterName = $PrinterName
  if (-not $document.PrinterSettings.IsValid) {
    throw "Windows printer '$PrinterName' is not installed or is unavailable."
  }

  if ($Copies -gt 0) {
    $document.PrinterSettings.Copies = [int16]$Copies
  }

  $paperWidthHundredths = [int][Math]::Round($WidthMm / 25.4 * 100)
  $paperHeightHundredths = [int][Math]::Round($HeightMm / 25.4 * 100)
  $paperSize = New-Object System.Drawing.Printing.PaperSize('CorePOSDymo57x32', $paperWidthHundredths, $paperHeightHundredths)

  $document.DefaultPageSettings.Landscape = $false
  $document.DefaultPageSettings.PaperSize = $paperSize
  $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $document.OriginAtMargins = $false
  $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController

  $handler = [System.Drawing.Printing.PrintPageEventHandler]{
    param($sender, $eventArgs)
    $eventArgs.Graphics.Clear([System.Drawing.Color]::White)
    $eventArgs.Graphics.DrawImage($image, $eventArgs.PageBounds)
    $eventArgs.HasMorePages = $false
  }

  $document.add_PrintPage($handler)
  try {
    $document.Print()
  }
  finally {
    $document.remove_PrintPage($handler)
  }
}
finally {
  if ($null -ne $image) {
    $image.Dispose()
  }
  if ($null -ne $document) {
    $document.Dispose()
  }
}
