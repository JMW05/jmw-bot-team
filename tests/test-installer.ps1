# Automated checks for scripts/install-jmw-agents.ps1 and scripts/check-jmw-state.ps1.
# Works only in throwaway temp folders. Usage: pwsh -File tests/test-installer.ps1
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Installer = Join-Path $RepoRoot 'scripts/install-jmw-agents.ps1'
$Checker = Join-Path $RepoRoot 'scripts/check-jmw-state.ps1'
$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("jmw-install-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temp | Out-Null
$script:Failures = 0
$script:Passes = 0

function Assert([bool]$Condition, [string]$Name) {
    if ($Condition) { $script:Passes++; Write-Host "PASS  $Name" }
    else { $script:Failures++; Write-Host "FAIL  $Name" }
}
function New-Project([string]$Name) {
    $p = Join-Path $Temp $Name
    New-Item -ItemType Directory -Path $p | Out-Null
    Set-Content -Path (Join-Path $p 'CLAUDE.md') -Value "# Project's own instructions`nDo not touch." -NoNewline
    return $p
}
function Hash([string]$Path) { (Get-FileHash $Path -Algorithm SHA256).Hash }

try {
    # 1. Fresh install with a profile
    $P = New-Project 'fresh'
    New-Item -ItemType Directory -Force -Path (Join-Path $P '.claude/skills/their-own-skill') | Out-Null
    Set-Content (Join-Path $P '.claude/skills/their-own-skill/SKILL.md') 'their skill'
    $ClaudeHash = Hash (Join-Path $P 'CLAUDE.md')
    & $Installer -TargetPath $P -ProjectSlug 'lavish' | Out-Null
    $J = Join-Path $P '.jmw'
    Assert ((Hash (Join-Path $P 'CLAUDE.md')) -eq $ClaudeHash) 'root CLAUDE.md untouched on fresh install'
    foreach ($f in 'STATUS.md','DECISIONS.md','OPEN-ISSUES.md','HANDOFF.md','RUN-LOG.md','PROJECT.md','JMW-INCLUDE.md','JMW-MASTER.md') {
        Assert (Test-Path (Join-Path $J $f)) ".jmw/$f created"
    }
    foreach ($s in 'screenshots','videos','qa-reports','evidence','logs') {
        Assert (Test-Path (Join-Path $J "artifacts/$s")) ".jmw/artifacts/$s created"
    }
    foreach ($o in 'PERMISSIONS.md','MODES.md','STATE-MACHINES.md','TASK-CONTRACT.md','PM-LOOP.md','COMMANDS.md','ARTIFACTS.md','PROJECT-POLICY.md') {
        Assert (Test-Path (Join-Path $J "orchestration/$o")) ".jmw/orchestration/$o installed"
    }
    foreach ($k in 'jmw-review','jmw-fix-p1','jmw-owner-ready','jmw-launch-check','jmw-finance-review','jmw-game-build') {
        Assert (Test-Path (Join-Path $P ".claude/skills/$k/SKILL.md")) "skill $k installed"
    }
    Assert ((Get-Content (Join-Path $P '.claude/skills/their-own-skill/SKILL.md') -Raw).Trim() -eq 'their skill') "project's own skill untouched"
    Assert ((Get-ChildItem (Join-Path $P '.claude/agents') -Filter '*.md').Count -ge 12) 'agents installed'
    $Snapshot = Get-ChildItem (Join-Path $RepoRoot 'projects/handoffs') -Filter 'lavish-*.md' | Sort-Object Name -Descending | Select-Object -First 1
    Assert ((Hash (Join-Path $J 'HANDOFF.md')) -eq (Hash $Snapshot.FullName)) 'missing HANDOFF.md seeded from newest Lavish snapshot'
    Assert (Test-Path (Join-Path $J "handoff-snapshots/$($Snapshot.Name)")) 'snapshot also copied to .jmw/handoff-snapshots/'
    Assert ((Get-Content (Join-Path $J 'STATUS.md') -Raw) -match '- project: lavish') 'STATUS.md pre-filled with project slug'
    & pwsh -NoProfile -File $Checker -ProjectPath $P | Out-Null
    Assert ($LASTEXITCODE -eq 0) 'state checker passes on fresh templates'

    # 2. Re-install must not overwrite project state
    Add-Content (Join-Path $J 'STATUS.md') "`nPROJECT EDIT"
    Set-Content (Join-Path $J 'HANDOFF.md') '# Project handoff written by the project'
    Add-Content (Join-Path $J 'DECISIONS.md') "`nPROJECT EDIT"
    Add-Content (Join-Path $J 'RUN-LOG.md') "`n- 2026-10-13 05:00 | T-1 | qa-tester | L0 | done | QA -> QA | none | project line"
    Add-Content (Join-Path $J 'artifacts/README.md') "`nPROJECT EDIT"
    $Issues = (Get-Content (Join-Path $J 'OPEN-ISSUES.md') -Raw).Replace("`r`n", "`n").Replace("## OPEN`n`n(none yet)", @"
## OPEN

### ISSUE-001 — Quote email not verified in a real inbox
- priority: P1
- type: qa
- status: needs-human
- owner: qa-tester
- environment: staging
- evidence: none yet
- blocked_by: owner login to Cloudflare Access
- requires_human_decision: no
- requires_credentials: yes
- next_action: owner completes Access login in normal Chrome
- verification_required: email received and rendered correctly
- verified_by: none
- verification_status: not-verified
- opened: 2026-10-13
"@)
    Set-Content (Join-Path $J 'OPEN-ISSUES.md') $Issues -NoNewline
    Set-Content (Join-Path $J 'artifacts/screenshots/keep.png') 'fake image'
    $Before = @{}
    foreach ($f in 'STATUS.md','HANDOFF.md','DECISIONS.md','RUN-LOG.md','OPEN-ISSUES.md','artifacts/README.md','artifacts/screenshots/keep.png') { $Before[$f] = Hash (Join-Path $J $f) }
    $Out = & $Installer -TargetPath $P -ProjectSlug 'lavish' 6>&1 | Out-String
    foreach ($f in $Before.Keys) { Assert ((Hash (Join-Path $J $f)) -eq $Before[$f]) "re-install kept existing .jmw/$f" }
    Assert ((Hash (Join-Path $P 'CLAUDE.md')) -eq $ClaudeHash) 'root CLAUDE.md untouched on re-install'
    Assert ($Out -match 'Kept existing project state') 'installer reports kept state'
    $CheckOut = & pwsh -NoProfile -File $Checker -ProjectPath $P | Out-String
    Assert ($LASTEXITCODE -eq 0) 'state checker passes with a real issue'
    Assert ($CheckOut -match 'Issues found: 1') 'checker reads the issue (template ignored)'

    # 3. Install without a profile: HANDOFF comes from the blank template
    $P2 = New-Project 'noprofile'
    & $Installer -TargetPath $P2 | Out-Null
    Assert ((Hash (Join-Path $P2 '.jmw/HANDOFF.md')) -eq (Hash (Join-Path $RepoRoot 'templates/jmw-state/HANDOFF.md'))) 'HANDOFF.md from template when no snapshot'
    Assert (-not (Test-Path (Join-Path $P2 '.jmw/PROJECT.md'))) 'no PROJECT.md without a profile'

    # 4. Unknown profile fails before writing anything
    $P3 = New-Project 'badslug'
    $Threw = $false
    try { & $Installer -TargetPath $P3 -ProjectSlug 'does-not-exist' | Out-Null } catch { $Threw = $true }
    Assert $Threw 'unknown profile is rejected'
    Assert (-not (Test-Path (Join-Path $P3 '.jmw'))) 'nothing written for unknown profile'

    # 5. Checker catches broken state
    $Bad = (Get-Content (Join-Path $J 'OPEN-ISSUES.md') -Raw).Replace("`r`n", "`n").Replace('- priority: P1', '- priority: HIGH').Replace('- status: needs-human', '- status: verified').Replace("- type: qa`n", '')
    Set-Content (Join-Path $J 'OPEN-ISSUES.md') $Bad -NoNewline
    $CheckOut = & pwsh -NoProfile -File $Checker -ProjectPath $P | Out-String
    Assert ($LASTEXITCODE -eq 1) 'state checker fails on broken issue'
    Assert ($CheckOut -match "priority 'HIGH'") 'checker flags bad priority'
    Assert ($CheckOut -match "missing '- type:'") 'checker flags missing field'
    Assert ($CheckOut -match 'verified_by is empty') 'checker flags verified without verifier'
}
finally {
    Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Passed: $script:Passes  Failed: $script:Failures"
if ($script:Failures -gt 0) { exit 1 }
exit 0
