# Keeps the E2B coordinator (e2b_worker.py, staging) running on this machine.
# Started at sign-in by the Task Scheduler task "Aistrix E2B coordinator (staging)".
# One supervisor at a time (a named mutex); it starts the coordinator when none
# is running, waits for it to exit, logs the exit and starts it again after a
# pause that grows while it keeps failing quickly. Output goes to the same
# logs as a manual start: aistrix-backend\.data\e2b-staging.std{out,err}.log.
param(
    [string]$EnvFile = ".env.staging",
    [int]$PauseSeconds = 30,
    [int]$MaxPauseSeconds = 600
)

$ErrorActionPreference = "Stop"
$backend = Split-Path -Parent $PSScriptRoot
$python = Join-Path $backend "venv\Scripts\python.exe"
$worker = Join-Path $backend "e2b_worker.py"
$data = Join-Path $backend ".data"
$stdout = Join-Path $data "e2b-staging.stdout.log"
$stderr = Join-Path $data "e2b-staging.stderr.log"
$supervisorLog = Join-Path $data "e2b-supervisor.log"
New-Item -ItemType Directory -Force -Path $data | Out-Null

function Write-Log([string]$message) {
    $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $message
    Add-Content -Path $supervisorLog -Value $line -Encoding utf8
}

function Get-Coordinator {
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*e2b_worker.py*" -and $_.CommandLine -notlike "*--check*" }
}

$mutex = New-Object System.Threading.Mutex($false, "Local\AistrixE2BSupervisor")
if (-not $mutex.WaitOne(0)) {
    exit 0          # another supervisor is already watching
}

try {
    Write-Log "Supervisor started (env $EnvFile)."
    $pause = $PauseSeconds
    while ($true) {
        $existing = @(Get-Coordinator)
        if ($existing.Count -gt 0) {
            # Started by hand or left from before: watch it instead of starting a second one.
            Write-Log ("Coordinator already running (pid {0}); waiting for it to exit." -f $existing[0].ProcessId)
            Wait-Process -Id $existing[0].ProcessId -ErrorAction SilentlyContinue
            Write-Log "Coordinator exited."
            Start-Sleep -Seconds $PauseSeconds
            continue
        }
        Add-Content -Path $stdout -Value ("--- started by supervisor {0}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")) -Encoding utf8
        $env:PYTHONUNBUFFERED = "1"
        $env:PYTHONIOENCODING = "utf-8"
        $started = Get-Date
        # cmd's >> appends live, so the logs read the same as after a manual start.
        $command = "`"`"$python`" `"$worker`" --env-file $EnvFile >> `"$stdout`" 2>> `"$stderr`"`""
        $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/s /c $command" `
            -WorkingDirectory $backend -WindowStyle Hidden -PassThru
        Write-Log ("Coordinator started (cmd pid {0})." -f $process.Id)
        $process.WaitForExit()
        $ran = ((Get-Date) - $started).TotalSeconds
        Write-Log ("Coordinator exited with code {0} after {1:N0}s." -f $process.ExitCode, $ran)
        # A long run resets the pause; quick repeated failures (bad config, no
        # network) wait 30s, then 60s, 120s ... up to MaxPauseSeconds.
        if ($ran -gt 300) { $pause = $PauseSeconds }
        Write-Log ("Restarting in {0}s." -f $pause)
        Start-Sleep -Seconds $pause
        $pause = [Math]::Min($pause * 2, $MaxPauseSeconds)
    }
}
finally {
    $mutex.ReleaseMutex()
}
