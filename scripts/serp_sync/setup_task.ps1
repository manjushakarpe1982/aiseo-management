# ─────────────────────────────────────────────────────────────────────────────
# setup_task.ps1
# Registers a Windows Task Scheduler job to run SERP Sync daily.
#
# Run once (as Administrator):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\setup_task.ps1
#
# Customise the $RunTime variable below to change the daily trigger time.
# ─────────────────────────────────────────────────────────────────────────────

$TaskName   = "AISEO_SerpSync"
$RunTime    = "09:00"          # 24h local time
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$BatchFile  = Join-Path $ScriptDir "run.bat"
$LogDir     = $ScriptDir

# Verify the batch file exists
if (-not (Test-Path $BatchFile)) {
    Write-Error "run.bat not found at: $BatchFile"
    exit 1
}

# Remove existing task if present (allows re-running this script to update)
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing task '$TaskName' ..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Action: run the batch file
$Action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$BatchFile`"" `
    -WorkingDirectory $ScriptDir

# Trigger: daily at $RunTime
$Trigger = New-ScheduledTaskTrigger `
    -Daily `
    -At $RunTime

# Settings: run whether user is logged on or not, restart on failure
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit  (New-TimeSpan -Minutes 30) `
    -RestartCount        3 `
    -RestartInterval     (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable  $true `
    -RunOnlyIfNetworkAvailable $true

# Principal: run as SYSTEM so it works even when no user is logged in
$Principal = New-ScheduledTaskPrincipal `
    -UserId    "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel  Highest

# Register
Register-ScheduledTask `
    -TaskName  $TaskName `
    -Action    $Action `
    -Trigger   $Trigger `
    -Settings  $Settings `
    -Principal $Principal `
    -Description "Daily AISEO SERP position + search volume sync via GSC and Google Ads APIs"

Write-Host ""
Write-Host "Task '$TaskName' registered successfully."
Write-Host "  Runs daily at : $RunTime (local time)"
Write-Host "  Working dir   : $ScriptDir"
Write-Host "  Log file      : $ScriptDir\serp_sync.log"
Write-Host ""
Write-Host "Verify in Task Scheduler (taskschd.msc) or run:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName' | Format-List"
Write-Host ""
Write-Host "To run immediately:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "To remove:"
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
