[CmdletBinding()]
param(
  [string]$RepoPath = "C:\CorePOS",
  [string]$EntrypointPath = "C:\Users\coreposadmin\corepos-runtime\deploy-corepos.cmd",
  [string]$ReleaseStateDir = "C:\CorePOS\.corepos-runtime",
  [string]$BaseUrl = "http://127.0.0.1:3000",
  [string]$Pm2ProcessName = "corepos",
  [string]$HealthTaskName = "CorePOS Health Monitor"
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

function Test-PathResult {
  param(
    [string]$Area,
    [string]$Name,
    [string]$TargetPath,
    [string]$FailureStatus = "FAIL"
  )

  if (Test-Path $TargetPath) {
    Add-Result "PASS" $Area $Name $TargetPath
    return $true
  }

  Add-Result $FailureStatus $Area $Name "$TargetPath not found"
  return $false
}

function Invoke-JsonCheck {
  param(
    [string]$Area,
    [string]$Name,
    [string]$Url,
    [scriptblock]$Validate
  )

  try {
    $response = Invoke-RestMethod -Uri $Url -TimeoutSec 5
    & $Validate $response
    Add-Result "PASS" $Area $Name $Url
  } catch {
    Add-Result "FAIL" $Area $Name $_.Exception.Message
  }
}

if (-not (Test-CommandAvailable "git")) {
  Add-Result "FAIL" "runtime" "git available" "git not found on PATH"
} else {
  Add-Result "PASS" "runtime" "git available" "git found on PATH"
}

if (-not (Test-CommandAvailable "node")) {
  Add-Result "FAIL" "runtime" "node available" "node not found on PATH"
} else {
  Add-Result "PASS" "runtime" "node available" "node found on PATH"
}

if (-not (Test-CommandAvailable "npm")) {
  Add-Result "FAIL" "runtime" "npm available" "npm not found on PATH"
} else {
  Add-Result "PASS" "runtime" "npm available" "npm found on PATH"
}

$repoExists = Test-PathResult "repo" "runtime checkout" $RepoPath
Test-PathResult "repo" "external deploy entrypoint" $EntrypointPath
$stateDirExists = Test-PathResult "release-state" "release state directory" $ReleaseStateDir

if ($repoExists) {
  Test-PathResult "repo" "package.json" (Join-Path $RepoPath "package.json")
  Test-PathResult "repo" "frontend bundle" (Join-Path $RepoPath "frontend\dist\index.html")
  Test-PathResult "repo" "deploy health script" (Join-Path $RepoPath "scripts\deploy_health_check.js")
  Test-PathResult "repo" "health monitor script" (Join-Path $RepoPath "scripts\health_monitor.js")
  Test-PathResult "repo" "release runner script" (Join-Path $RepoPath "scripts\manage_production_release.js")

  if (Test-CommandAvailable "git") {
    try {
      $branchLine = git -C $RepoPath status --short --branch | Select-Object -First 1
      Add-Result "PASS" "repo" "git status" $branchLine
    } catch {
      Add-Result "FAIL" "repo" "git status" $_.Exception.Message
    }

    try {
      $dirtyLines = git -C $RepoPath status --porcelain
      if ($dirtyLines) {
        Add-Result "WARN" "repo" "working tree cleanliness" "Runtime checkout has local modifications"
      } else {
        Add-Result "PASS" "repo" "working tree cleanliness" "Runtime checkout is clean"
      }
    } catch {
      Add-Result "FAIL" "repo" "working tree cleanliness" $_.Exception.Message
    }

    try {
      $head = git -C $RepoPath rev-parse HEAD
      Add-Result "PASS" "repo" "runtime HEAD" $head.Trim()
    } catch {
      Add-Result "FAIL" "repo" "runtime HEAD" $_.Exception.Message
    }
  }
}

if ($stateDirExists) {
  foreach ($stateFile in @(
      "successful-releases.json",
      "current-release.json",
      "last-release-result.json",
      "last-release-summary.md",
      "health-state.json"
    )) {
    Test-PathResult "release-state" $stateFile (Join-Path $ReleaseStateDir $stateFile) "WARN"
  }
}

if (Test-CommandAvailable "pm2")) {
  try {
    $pm2Json = pm2 jlist
    $pm2Processes = $pm2Json | ConvertFrom-Json
    $targetProcess = $pm2Processes | Where-Object {
      $_.name -eq $Pm2ProcessName -or $_.pm2_env.name -eq $Pm2ProcessName
    } | Select-Object -First 1

    if ($null -eq $targetProcess) {
      Add-Result "FAIL" "process" "PM2 process" "No PM2 process named '$Pm2ProcessName' was found"
    } else {
      $pm2Status = $targetProcess.pm2_env.status
      if ($pm2Status -eq "online") {
        Add-Result "PASS" "process" "PM2 process" "'$Pm2ProcessName' is online"
      } else {
        Add-Result "FAIL" "process" "PM2 process" "'$Pm2ProcessName' status is $pm2Status"
      }

      $requiredPm2Env = @("DATABASE_URL", "AUTH_JWT_SECRET", "COOKIE_SECRET", "NODE_ENV", "PORT")
      foreach ($envName in $requiredPm2Env) {
        $hasValue = $false
        if ($targetProcess.pm2_env.env -and $targetProcess.pm2_env.env.PSObject.Properties.Name -contains $envName) {
          $value = [string]$targetProcess.pm2_env.env.$envName
          $hasValue = -not [string]::IsNullOrWhiteSpace($value)
        }

        if ($hasValue) {
          Add-Result "PASS" "process" "PM2 env $envName" "set"
        } else {
          Add-Result "FAIL" "process" "PM2 env $envName" "missing"
        }
      }

      $optionalPm2Env = "PUBLIC_APP_URL"
      $hasPublicAppUrl = $false
      if ($targetProcess.pm2_env.env -and $targetProcess.pm2_env.env.PSObject.Properties.Name -contains $optionalPm2Env) {
        $value = [string]$targetProcess.pm2_env.env.$optionalPm2Env
        $hasPublicAppUrl = -not [string]::IsNullOrWhiteSpace($value)
      }

      if ($hasPublicAppUrl) {
        Add-Result "PASS" "process" "PM2 env PUBLIC_APP_URL" "set"
      } else {
        Add-Result "WARN" "process" "PM2 env PUBLIC_APP_URL" "missing"
      }
    }
  } catch {
    Add-Result "FAIL" "process" "PM2 inspection" $_.Exception.Message
  }
} else {
  Add-Result "FAIL" "process" "PM2 available" "pm2 not found on PATH"
}

Invoke-JsonCheck "health" "detailed health endpoint" "$BaseUrl/health?details=1" {
  param($response)
  if ($response.status -ne "ok") {
    throw "status is $($response.status)"
  }
  if ($response.checks.database.status -ne "ok") {
    throw "database status is $($response.checks.database.status)"
  }
  if ($response.checks.migrations.status -ne "ok") {
    throw "migrations status is $($response.checks.migrations.status)"
  }
}

Invoke-JsonCheck "health" "runtime version endpoint" "$BaseUrl/api/system/version" {
  param($response)
  if (-not $response.app.version) {
    throw "missing app.version"
  }
  if (-not $response.app.revision) {
    throw "missing app.revision"
  }
}

try {
  $loginResponse = Invoke-WebRequest -Uri "$BaseUrl/login" -UseBasicParsing -TimeoutSec 5
  if ($loginResponse.StatusCode -ne 200) {
    throw "status code $($loginResponse.StatusCode)"
  }
  if ($loginResponse.Content -notmatch "<html|<!doctype html") {
    throw "login response did not look like HTML"
  }
  Add-Result "PASS" "health" "login page" "$BaseUrl/login"
} catch {
  Add-Result "FAIL" "health" "login page" $_.Exception.Message
}

try {
  $task = Get-ScheduledTask -TaskName $HealthTaskName -ErrorAction Stop
  $taskDetail = "$($task.TaskPath)$($task.TaskName) state=$($task.State)"
  if ($task.Actions.Execute -match "node|npm|powershell|pwsh") {
    Add-Result "PASS" "monitoring" "health monitor scheduled task" $taskDetail
  } else {
    Add-Result "WARN" "monitoring" "health monitor scheduled task" "$taskDetail action does not obviously run node/npm/powershell"
  }
} catch {
  Add-Result "FAIL" "monitoring" "health monitor scheduled task" $_.Exception.Message
}

try {
  $runnerServices = Get-Service | Where-Object {
    $_.Name -like "actions.runner*" -or $_.DisplayName -like "GitHub Actions Runner*"
  }
  if (-not $runnerServices) {
    Add-Result "FAIL" "automation" "GitHub Actions runner service" "No GitHub Actions runner Windows service found"
  } elseif (($runnerServices | Where-Object Status -eq "Running").Count -eq 0) {
    Add-Result "FAIL" "automation" "GitHub Actions runner service" "Runner service found but not running"
  } else {
    $runningNames = ($runnerServices | Where-Object Status -eq "Running" | ForEach-Object Name) -join ", "
    Add-Result "PASS" "automation" "GitHub Actions runner service" $runningNames
  }
} catch {
  Add-Result "WARN" "automation" "GitHub Actions runner service" $_.Exception.Message
}

try {
  $cloudflareServices = Get-Service | Where-Object {
    $_.Name -like "*cloudflared*" -or $_.DisplayName -like "*Cloudflare*"
  }
  if (-not $cloudflareServices) {
    Add-Result "WARN" "network" "Cloudflare Tunnel service" "No Cloudflare-related Windows service found"
  } elseif (($cloudflareServices | Where-Object Status -eq "Running").Count -eq 0) {
    Add-Result "WARN" "network" "Cloudflare Tunnel service" "Cloudflare-related service found but not running"
  } else {
    $runningNames = ($cloudflareServices | Where-Object Status -eq "Running" | ForEach-Object Name) -join ", "
    Add-Result "PASS" "network" "Cloudflare Tunnel service" $runningNames
  }
} catch {
  Add-Result "WARN" "network" "Cloudflare Tunnel service" $_.Exception.Message
}

$results | Format-Table -AutoSize

$failCount = ($results | Where-Object Status -eq "FAIL").Count
$warnCount = ($results | Where-Object Status -eq "WARN").Count
$passCount = ($results | Where-Object Status -eq "PASS").Count

Write-Host ""
Write-Host "Validation summary: $passCount pass, $warnCount warn, $failCount fail"

if ($failCount -gt 0) {
  exit 1
}
