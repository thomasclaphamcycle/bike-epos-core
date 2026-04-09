param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterName,
  [Parameter(Mandatory = $true)]
  [string]$ReceiptPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ReceiptPath)) {
  throw "Receipt path '$ReceiptPath' does not exist."
}

$receiptBytes = [System.IO.File]::ReadAllBytes($ReceiptPath)
if ($receiptBytes.Length -le 0) {
  throw "Receipt path '$ReceiptPath' is empty."
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
  $docInfo.pDocName = 'CorePOS Thermal Receipt'
  $docInfo.pDataType = 'RAW'

  $docStarted = [CorePosRawPrinter]::StartDocPrinter($printerHandle, 1, $docInfo)
  if ($docStarted -le 0) {
    throw "Windows printer '$PrinterName' rejected the receipt job."
  }

  try {
    $written = 0
    $writeOk = [CorePosRawPrinter]::WritePrinter($printerHandle, $receiptBytes, $receiptBytes.Length, [ref]$written)
    if (-not $writeOk -or $written -ne $receiptBytes.Length) {
      throw "Windows printer '$PrinterName' did not accept the full receipt payload."
    }
  }
  finally {
    [void][CorePosRawPrinter]::EndDocPrinter($printerHandle)
  }
}
finally {
  [void][CorePosRawPrinter]::ClosePrinter($printerHandle)
}
