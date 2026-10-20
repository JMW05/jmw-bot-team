# Read-only check of a project's .jmw state files. Changes nothing.
# Usage: .\scripts\check-jmw-state.ps1 -ProjectPath "C:\path\to\project"
# Exit code 0 = no errors (warnings may still be listed), 1 = errors found.
param(
    [Parameter(Mandatory=$true)][string]$ProjectPath
)

$ErrorActionPreference = 'Stop'
$JmwDir = Join-Path $ProjectPath '.jmw'
$Errors = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]

$States = @{
    website = @('INTAKE','DISCOVERY','BUILDING','DESIGN_REVIEW','QA','STAGING_READY','OWNER_REVIEW','LAUNCH_REVIEW','PRODUCTION_APPROVAL','LIVE','MAINTENANCE')
    game    = @('CONCEPT','VERTICAL_SLICE','PLAYABLE_BUILD','GAME_QA','VISUAL_REVIEW','CONTENT_COMPLETE','RELEASE_CANDIDATE')
    finance = @('OPEN_PERIOD','DATA_GATHERING','RECONCILIATION','EXCEPTION_REVIEW','TREASURER_REVIEW','CLOSE_READY','CLOSED','REPORTING')
}
$Modes = @('REVIEW','FIX','STAGING','LAUNCH_REVIEW','OVERNIGHT_SAFE','FINANCE_REVIEW','GAME_BUILD')
$IssueKeys = @('priority','type','status','owner','environment','evidence','blocked_by','requires_human_decision','requires_credentials','next_action','verification_required','verified_by','verification_status')
$Priorities = @('P0','P1','P2','P3')
$IssueStatuses = @('open','in-progress','fixed-unverified','verified','blocked','needs-human','wont-fix')
$VerificationStatuses = @('not-verified','passed','failed','partial')
$YesNo = @('yes','no')

function Get-Value([string]$Line) {
    # "- key: value   <!-- comment -->" -> "value"
    $v = ($Line -split ':', 2)[1]
    $v = $v -replace '<!--.*?-->', ''
    return $v.Trim()
}

foreach ($f in @('STATUS.md','DECISIONS.md','OPEN-ISSUES.md','HANDOFF.md','RUN-LOG.md')) {
    if (-not (Test-Path (Join-Path $JmwDir $f))) { $Errors.Add("Missing .jmw/$f") }
}

# STATUS.md: CURRENT block
$StatusPath = Join-Path $JmwDir 'STATUS.md'
if (Test-Path $StatusPath) {
    $Status = @{}
    foreach ($Line in Get-Content $StatusPath) {
        if ($Line -match '^- ([a-z_0-9]+):') { if (-not $Status.ContainsKey($Matches[1])) { $Status[$Matches[1]] = Get-Value $Line } }
    }
    foreach ($k in @('project','workflow','current_state','target_state','mode','environment','waiting_on_human','human_gate','next_action','last_updated')) {
        if (-not $Status.ContainsKey($k)) { $Errors.Add("STATUS.md is missing '- ${k}:'") }
    }
    $wf = $Status['workflow']
    if ($wf -and -not $States.ContainsKey($wf)) { $Errors.Add("STATUS.md workflow '$wf' must be website, game or finance") }
    elseif ($wf -and $Status['current_state'] -and ($States[$wf] -notcontains $Status['current_state'])) {
        $Warnings.Add("STATUS.md current_state '$($Status['current_state'])' is not a built-in $wf state (fine only if PROJECT.md adds it as an override)")
    }
    if ($Status['mode'] -and ($Modes -notcontains $Status['mode'])) { $Errors.Add("STATUS.md mode '$($Status['mode'])' is not a JMW mode") }
    if ($Status['waiting_on_human'] -and ($YesNo -notcontains $Status['waiting_on_human'])) { $Errors.Add("STATUS.md waiting_on_human must be yes or no") }
}

# OPEN-ISSUES.md: one block per "### ISSUE-xxx", ignoring the -000 template
$IssuesPath = Join-Path $JmwDir 'OPEN-ISSUES.md'
$IssueCount = 0
if (Test-Path $IssuesPath) {
    $Current = $null
    $Issues = [ordered]@{}
    foreach ($Line in Get-Content $IssuesPath) {
        if ($Line -match '^### (ISSUE-[A-Za-z0-9-]+)') {
            $Id = $Matches[1]
            if ($Id -match '-000$') { $Current = $null; continue }
            if ($Issues.Contains($Id)) { $Errors.Add("Duplicate issue ID $Id") }
            $Current = @{}
            $Issues[$Id] = $Current
        } elseif ($Line -match '^#{1,2} ') {
            $Current = $null
        } elseif ($Current -ne $null -and $Line -match '^- ([a-z_]+):') {
            $Current[$Matches[1]] = Get-Value $Line
        }
    }
    foreach ($Id in $Issues.Keys) {
        $I = $Issues[$Id]
        $IssueCount++
        foreach ($k in $IssueKeys) { if (-not $I.ContainsKey($k)) { $Errors.Add("$Id is missing '- ${k}:'") } }
        if ($I['priority'] -and ($Priorities -notcontains $I['priority'])) { $Errors.Add("$Id priority '$($I['priority'])' must be P0-P3") }
        if ($I['status'] -and ($IssueStatuses -notcontains $I['status'])) { $Errors.Add("$Id status '$($I['status'])' is not allowed") }
        if ($I['verification_status'] -and ($VerificationStatuses -notcontains $I['verification_status'])) { $Errors.Add("$Id verification_status '$($I['verification_status'])' is not allowed") }
        foreach ($k in @('requires_human_decision','requires_credentials')) {
            if ($I[$k] -and ($YesNo -notcontains $I[$k])) { $Errors.Add("$Id $k must be yes or no") }
        }
        if ($I['status'] -eq 'verified' -and ($I['verified_by'] -in @($null,'','none'))) { $Errors.Add("$Id is 'verified' but verified_by is empty") }
        if ($I['status'] -eq 'verified' -and $I['verified_by'] -and $I['verified_by'] -eq $I['owner'] -and $I['owner'] -match 'builder') {
            $Errors.Add("$Id was verified by its own builder ($($I['owner'])); independent verification is required")
        }
    }
}

Write-Host "JMW state check: $JmwDir"
Write-Host "Issues found: $IssueCount"
foreach ($w in $Warnings) { Write-Host "WARNING: $w" }
foreach ($e in $Errors) { Write-Host "ERROR: $e" }
if ($Errors.Count -gt 0) { Write-Host "RESULT: FAIL ($($Errors.Count) error(s))"; exit 1 }
Write-Host 'RESULT: PASS'
exit 0
