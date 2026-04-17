[CmdletBinding()]
param(
  [string]$RepoPath = "C:\CorePOS",
  [string]$BaseUrl = "http://127.0.0.1:3100",
  [string]$ExpectedRevision = "",
  [switch]$Json
)

$ErrorActionPreference = "Stop"

$results = [System.Collections.Generic.List[object]]::new()

function Add-Result {
  param(
    [string]$Status,
    [string]$Area,
    [string]$Name,
    [string]$Detail
  )

  $results.Add([pscustomobject]@{
      Status = $Status
      Area   = $Area
      Name   = $Name
      Detail = $Detail
    })
}

function Test-CommandAvailable {
  param([string]$CommandName)

  return $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Test-RevisionMatch {
  param(
    [string]$Actual,
    [string]$Expected
  )

  if (-not $Actual -or -not $Expected) {
    return $false
  }

  return $Actual -eq $Expected -or $Actual.StartsWith($Expected) -or $Expected.StartsWith($Actual)
}

if (-not (Test-CommandAvailable "git")) {
  throw "git not found on PATH"
}

if (-not (Test-Path $RepoPath)) {
  throw "$RepoPath not found"
}

$branchLine = git -C $RepoPath status --short --branch | Select-Object -First 1
$dirtyLines = @(git -C $RepoPath status --porcelain)
$repoHead = (git -C $RepoPath rev-parse HEAD).Trim()
$version = Invoke-RestMethod -Uri "$BaseUrl/api/system/version" -TimeoutSec 5
$health = Invoke-RestMethod -Uri "$BaseUrl/health?details=1" -TimeoutSec 5

$clean = ($dirtyLines.Count -eq 0)
$healthStatus = [string]$health.status
$databaseStatus = [string]$health.checks.database.status
$migrationsStatus = [string]$health.checks.migrations.status
$liveRevision = [string]$version.app.revision
$liveVersion = [string]$version.app.version
$healthOk = $healthStatus -eq "ok" -and $databaseStatus -eq "ok" -and $migrationsStatus -eq "ok"

Add-Result ($(if ($clean) { "PASS" } else { "WARN" })) "windows" "working tree" $(if ($clean) {
    "$RepoPath is clean"
  } else {
    "$RepoPath has $($dirtyLines.Count) local modification(s)"
  })

Add-Result ($(if ($healthOk) { "PASS" } else { "FAIL" })) "windows" "runtime health" "status=$healthStatus database=$databaseStatus migrations=$migrationsStatus"

if ($ExpectedRevision) {
  Add-Result ($(if ($repoHead -eq $ExpectedRevision) { "PASS" } else { "FAIL" })) "windows" "runtime HEAD" "$repoHead expected=$ExpectedRevision"
  Add-Result ($(if (Test-RevisionMatch -Actual $liveRevision -Expected $ExpectedRevision) { "PASS" } else { "FAIL" })) "windows" "live revision" "$liveRevision expected=$ExpectedRevision version=$liveVersion"
} else {
  Add-Result "PASS" "windows" "runtime HEAD" $repoHead
  Add-Result "PASS" "windows" "live revision" "$liveRevision version=$liveVersion"
}

$failCount = ($results | Where-Object Status -eq "FAIL").Count
$warnCount = ($results | Where-Object Status -eq "WARN").Count
$passCount = ($results | Where-Object Status -eq "PASS").Count

if ($Json) {
  [pscustomobject]@{
    branch           = [string]$branchLine
    clean            = $clean
    dirtyCount       = $dirtyLines.Count
    repoHead         = $repoHead
    liveRevision     = $liveRevision
    liveVersion      = $liveVersion
    healthStatus     = $healthStatus
    databaseStatus   = $databaseStatus
    migrationsStatus = $migrationsStatus
    passCount        = $passCount
    warnCount        = $warnCount
    failCount        = $failCount
    results          = $results
  } | ConvertTo-Json -Depth 6 -Compress

  if ($failCount -gt 0) {
    exit 1
  }

  exit 0
}

$results | Format-Table -AutoSize

Write-Host ""
Write-Host "Sync summary: $passCount pass, $warnCount warn, $failCount fail"

if ($failCount -gt 0) {
  exit 1
}
