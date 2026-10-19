# Bot Ops checks on this workstation (written for Windows; also runs on macOS/Linux):
# Node version, the node:test suite, and the installed .jmw/scripts in a throwaway project
# (run ledger, resource preflight refusal, timeout kill, crash loop, report dry run, send refusals).
# Works only in temp folders. Makes no network call: --send is only exercised where it must refuse.
# Usage: pwsh -NoProfile -File tests/test-bot-ops.ps1
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Installer = Join-Path $RepoRoot 'scripts/install-jmw-agents.ps1'
$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("jmw-botops-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temp | Out-Null
$script:Failures = 0
$script:Passes = 0

function Assert([bool]$Condition, [string]$Name) {
    if ($Condition) { $script:Passes++; Write-Host "PASS  $Name" }
    else { $script:Failures++; Write-Host "FAIL  $Name" }
}
# Runs node with an argument array (so "--" and quotes reach node unchanged) and captures
# stdout+stderr as text. Native stderr must not turn into a terminating error here.
function Invoke-Node([string[]]$NodeArgs) {
    $ErrorActionPreference = 'Continue'
    $out = & node @NodeArgs 2>&1 | ForEach-Object { "$_" } | Out-String
    return @{ code = $LASTEXITCODE; out = $out }
}
function Read-Ledger([string]$Project, [string]$RunKey) {
    Get-Content (Join-Path $Project ".jmw/runs/$RunKey.json") -Raw | ConvertFrom-Json
}
function Get-RunKey([string]$Text) { if ($Text -match 'RUN (R-\S+)') { $Matches[1] } else { $null } }

$SavedSecret = $env:CONTROL_ROOM_INGEST_SECRET
$SavedUrl = $env:JMW_INGEST_URL
try {
    # 1. Node 22+
    $NodeVersion = (Invoke-Node @('--version')).out.Trim()
    Assert ($NodeVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22) "Node 22 or newer ($NodeVersion)"

    # 2. node:test suite (includes the Control Room cross-check when that repo is a sibling folder
    #    or JMW_CONTROL_ROOM_PATH is set; it skips with a message otherwise)
    Push-Location $RepoRoot
    try { $r = Invoke-Node @('--test', 'tests/node/*.test.mjs') } finally { Pop-Location }
    $Summary = ($r.out -split "`n" | Where-Object { $_ -match '^# (tests|pass|fail|skipped) ' }) -join ', '
    Assert ($r.code -eq 0) "node --test suite passes ($Summary)"
    if ($r.code -ne 0) { Write-Host $r.out }

    # 3. Installed scripts in a throwaway project
    $P = Join-Path $Temp 'game'
    New-Item -ItemType Directory -Path $P | Out-Null
    & $Installer -TargetPath $P -ProjectSlug 'tales-from-the-crue' | Out-Null
    $J = Join-Path $P '.jmw'
    $Status = (Get-Content (Join-Path $J 'STATUS.md') -Raw).Replace('- workflow: website', '- workflow: game').Replace('- current_state: INTAKE', '- current_state: VERTICAL_SLICE')
    Set-Content (Join-Path $J 'STATUS.md') $Status -NoNewline
    $RunJs = Join-Path $J 'scripts/jmw-run.mjs'
    $PreJs = Join-Path $J 'scripts/jmw-preflight.mjs'
    $RepJs = Join-Path $J 'scripts/jmw-report.mjs'
    Assert ((Test-Path $RunJs) -and (Test-Path $PreJs) -and (Test-Path $RepJs)) 'scripts installed into .jmw/scripts'

    $r = Invoke-Node @($RunJs, 'start', '--project-root', $P, '--mode', 'GAME_BUILD', '--target', 'GAME_QA')
    $Run = Get-RunKey $r.out
    Assert ($r.code -eq 0 -and $Run -match '^R-\d{4}-\d{2}-\d{2}-tales-from-the-crue-01$') "start writes run $Run"
    Assert ((Get-Content (Join-Path $J 'RUN-LOG.md') -Raw) -match "RUN-START \| $Run \|") 'RUN-START line in RUN-LOG.md'

    $r = Invoke-Node @($RunJs, 'task-start', '--project-root', $P, '--run', $Run, '--task-key', 'T-win-01', '--agent', 'game-qa', '--goal', 'Headless checks', '--levels', 'L0')
    Assert ($r.code -eq 0) 'task-start'
    $r = Invoke-Node @($PreJs, '--project-root', $P)
    Assert ($r.code -eq 0 -or $r.code -eq 3) "preflight runs on this workstation (exit $($r.code))"
    Write-Host ($r.out.Trim() -replace '(?m)^', '      ')
    $r = Invoke-Node @($PreJs, '--project-root', $P, '--run', $Run, '--task-key', 'T-win-01', '--min-free-ram-mb', '99999999')
    Assert ($r.code -eq 3 -and $r.out -match 'BLOCKED' -and $r.out -match 'free RAM') 'preflight refuses with exit 3 and a plain reason'
    Assert ((Read-Ledger $P $Run).tasks[0].status -eq 'blocked') 'refusal recorded: task blocked in the run ledger'

    # Timeout budget: a quiet program is ended (taskkill on Windows) and the task fails
    $Sleeper = Join-Path $Temp 'sleeper.mjs'
    Set-Content $Sleeper 'setTimeout(() => {}, 120000);'
    $null = Invoke-Node @($RunJs, 'task-start', '--project-root', $P, '--run', $Run, '--task-key', 'T-win-02', '--agent', 'game-qa', '--goal', 'Timeout check', '--levels', 'L0')
    $r = Invoke-Node @($RunJs, 'spawn', '--project-root', $P, '--run', $Run, '--task-key', 'T-win-02', '--kind', 'node', '--label', 'Quiet helper',
        '--timeout-sec', '2', '--stall-sec', '1', '--', 'node', $Sleeper)
    $L = Read-Ledger $P $Run
    $Proc = $L.processes | Select-Object -Last 1
    Assert ($r.code -eq 124) "spawn ends a quiet program at its budget (exit $($r.code))"
    Assert ($Proc.status -eq 'killed' -and $Proc.ended_at) 'process recorded as killed'
    Start-Sleep -Milliseconds 500
    Assert ($null -eq (Get-Process -Id $Proc.pid -ErrorAction SilentlyContinue)) 'the program is really gone'
    Assert (($L.tasks | Where-Object task_key -eq 'T-win-02').status -eq 'failed') 'task recorded as failed with the reason'
    Assert (-not ((Get-Content (Join-Path $J "runs/$Run.json") -Raw) -match 'sleeper')) 'no command line or path in the ledger'

    # Labels that look like command lines are refused
    $r = Invoke-Node @($RunJs, 'proc-register', '--project-root', $P, '--run', $Run, '--kind', 'godot', '--label', 'C:\Godot\godot.exe --headless', '--pid', '4242')
    Assert ($r.code -ne 0) 'unsafe process label refused'

    # Report: dry run by default, no local paths; send refusals before any network
    $r = Invoke-Node @($RepJs, '--project-root', $P, '--run', $Run)
    Assert ($r.code -eq 0 -and $r.out -match '"schema": "jmw-report/1"') 'report dry run prints JSON'
    $Escaped = $Temp.Replace('\', '\\')
    Assert (-not $r.out.Contains($Temp) -and -not $r.out.Contains($Escaped)) 'report holds no local paths'
    $env:CONTROL_ROOM_INGEST_SECRET = $null
    $r = Invoke-Node @($RepJs, '--project-root', $P, '--run', $Run, '--send', '--url', 'http://127.0.0.1:9/x')
    Assert ($r.code -eq 5 -and $r.out -match 'CONTROL_ROOM_INGEST_SECRET') 'send refused without the secret variable'
    $r = Invoke-Node @($RepJs, '--project-root', $P, '--send', '--secret', 'not-a-real-value-for-testing-only-000000')
    Assert ($r.code -eq 5 -and -not $r.out.Contains('not-a-real-value')) 'secret as an argument refused and not echoed'
    $env:CONTROL_ROOM_INGEST_SECRET = 'test-only-not-a-real-secret-' + ('x' * 12)
    $r = Invoke-Node @($RepJs, '--project-root', $P, '--send', '--url', 'http://example.invalid/x')
    Assert ($r.code -eq 5 -and $r.out -match 'must be https') 'plain http to a remote host refused'

    # Crash loop: two interrupted runs in a row, the third ends blocked
    $null = Invoke-Node @($RunJs, 'start', '--project-root', $P, '--mode', 'GAME_BUILD')
    $r = Invoke-Node @($RunJs, 'start', '--project-root', $P, '--mode', 'GAME_BUILD')
    $Third = Get-RunKey $r.out
    Assert ($r.code -eq 4 -and (Read-Ledger $P $Third).run.status -eq 'blocked') 'third start after two interrupted runs ends blocked'
    Assert ((Get-Content (Join-Path $J 'RUN-LOG.md') -Raw) -match "RUN-END \| $Third \| blocked") 'RUN-END blocked written'
}
finally {
    $env:CONTROL_ROOM_INGEST_SECRET = $SavedSecret
    $env:JMW_INGEST_URL = $SavedUrl
    Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Passed: $script:Passes  Failed: $script:Failures"
if ($script:Failures -gt 0) { exit 1 }
exit 0
