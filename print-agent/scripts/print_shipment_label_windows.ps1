param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterName,
  [Parameter(Mandatory = $true)]
  [string]$LabelPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $LabelPath)) {
  throw "Label path '$LabelPath' does not exist."
}

$labelBytes = [System.IO.File]::ReadAllBytes($LabelPath)
if ($labelBytes.Length -le 0) {
  throw "Label path '$LabelPath' is empty."
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class CorePosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)]
    public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)]
    public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)]
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA docInfo);

  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
}
"@

$printerHandle = [IntPtr]::Zero
$opened = [CorePosRawPrinter]::OpenPrinter($PrinterName, [ref]$printerHandle, [IntPtr]::Zero)
if (-not $opened -or $printerHandle -eq [IntPtr]::Zero) {
  throw "Windows printer '$PrinterName' is not installed or is unavailable."
}

try {
  $docInfo = New-Object CorePosRawPrinter+DOCINFOA
  $docInfo.pDocName = 'CorePOS Shipment Label'
  $docInfo.pDataType = 'RAW'

  $docStarted = [CorePosRawPrinter]::StartDocPrinter($printerHandle, 1, $docInfo)
  if ($docStarted -le 0) {
    throw "Windows printer '$PrinterName' rejected the shipment label job."
  }

  try {
    $written = 0
    $writeOk = [CorePosRawPrinter]::WritePrinter($printerHandle, $labelBytes, $labelBytes.Length, [ref]$written)
    if (-not $writeOk -or $written -ne $labelBytes.Length) {
      throw "Windows printer '$PrinterName' did not accept the full shipment label payload."
    }
  }
  finally {
    [void][CorePosRawPrinter]::EndDocPrinter($printerHandle)
  }
}
finally {
  [void][CorePosRawPrinter]::ClosePrinter($printerHandle)
}
