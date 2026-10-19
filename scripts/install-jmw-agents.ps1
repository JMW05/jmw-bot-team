param(
    [Parameter(Mandatory=$true)][string]$TargetPath,
    [Parameter(Mandatory=$false)][string]$ProjectSlug
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$SourceAgents = Join-Path $RepoRoot '.claude\agents'

if (-not (Test-Path $TargetPath)) { throw "TargetPath does not exist: $TargetPath" }
if (-not (Test-Path $SourceAgents)) { throw "Source agents folder not found: $SourceAgents" }

# Validate the profile before writing anything, so a typo cannot leave a half-installed project.
if ($ProjectSlug) {
    $ProfileFile = Join-Path $RepoRoot ("projects\{0}.md" -f $ProjectSlug)
    if (-not (Test-Path $ProfileFile)) { throw "Unknown project profile: $ProjectSlug" }
}

$TargetAgents = Join-Path $TargetPath '.claude\agents'
New-Item -ItemType Directory -Force -Path $TargetAgents | Out-Null
Copy-Item -Path (Join-Path $SourceAgents '*.md') -Destination $TargetAgents -Force

# JMW command skills (/jmw-review, /jmw-owner-ready, ...). Only jmw-* skill folders
# are replaced; any other skills the project has are left alone.
$SourceSkills = Join-Path $RepoRoot '.claude\skills'
if (Test-Path $SourceSkills) {
    $TargetSkills = Join-Path $TargetPath '.claude\skills'
    New-Item -ItemType Directory -Force -Path $TargetSkills | Out-Null
    Get-ChildItem -Path $SourceSkills -Directory -Filter 'jmw-*' | ForEach-Object {
        $Dest = Join-Path $TargetSkills $_.Name
        New-Item -ItemType Directory -Force -Path $Dest | Out-Null
        Copy-Item -Path (Join-Path $_.FullName '*') -Destination $Dest -Recurse -Force
    }
}

$JmwDir = Join-Path $TargetPath '.jmw'
New-Item -ItemType Directory -Force -Path $JmwDir | Out-Null

# Install the shared JMW support bundle into .jmw so synced agents can always
# find their standards, checklists, workflows, orchestration rules, and report
# template without polluting or overwriting the target project's own root files.
# These are framework files owned by the master repo, so they are refreshed on every sync.
$SharedFolders = @('standards', 'checklists', 'workflows', 'orchestration')
foreach ($FolderName in $SharedFolders) {
    $SourceFolder = Join-Path $RepoRoot $FolderName
    $TargetFolder = Join-Path $JmwDir $FolderName
    if (Test-Path $SourceFolder) {
        New-Item -ItemType Directory -Force -Path $TargetFolder | Out-Null
        Copy-Item -Path (Join-Path $SourceFolder '*') -Destination $TargetFolder -Recurse -Force
    }
}

$MasterInstructions = Join-Path $RepoRoot 'CLAUDE.md'
if (Test-Path $MasterInstructions) {
    Copy-Item $MasterInstructions (Join-Path $JmwDir 'JMW-MASTER.md') -Force
}

$IncludeFile = Join-Path $RepoRoot 'orchestration\JMW-INCLUDE.md'
if (Test-Path $IncludeFile) {
    Copy-Item $IncludeFile (Join-Path $JmwDir 'JMW-INCLUDE.md') -Force
}

$ReportTemplate = Join-Path $RepoRoot 'templates\reports\JMW-REVIEW.md'
if (Test-Path $ReportTemplate) {
    $TargetReportDir = Join-Path $JmwDir 'templates\reports'
    New-Item -ItemType Directory -Force -Path $TargetReportDir | Out-Null
    Copy-Item $ReportTemplate (Join-Path $TargetReportDir 'JMW-REVIEW.md') -Force
}

# Bot Ops scripts (run ledger, resource preflight, report builder). Framework files owned by
# the master repo, refreshed on every sync into .jmw/scripts/. They need Node 22; nothing else.
$SourceScripts = Join-Path $RepoRoot 'scripts'
$TargetScripts = Join-Path $JmwDir 'scripts'
New-Item -ItemType Directory -Force -Path $TargetScripts | Out-Null
foreach ($ScriptName in @('jmw-lib.mjs', 'jmw-run.mjs', 'jmw-preflight.mjs', 'jmw-report.mjs')) {
    Copy-Item (Join-Path $SourceScripts $ScriptName) (Join-Path $TargetScripts $ScriptName) -Force
}

# Workstation-local pointer back to this master repo, so the Project Manager can read
# the CURRENT capability state (config/capabilities.json here) instead of a copy that
# would go stale. .jmw/local/ ignores itself in git, so the path is never committed.
# Refreshed on every sync. No capability state is ever copied into the project.
$LocalDir = Join-Path $JmwDir 'local'
New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null
Set-Content -Path (Join-Path $LocalDir '.gitignore') -Value "# Workstation-local JMW files. Never commit.`n*" -NoNewline
$MasterRootFull = (Resolve-Path $RepoRoot).Path
[ordered]@{
    note              = 'Written by install-jmw-agents.ps1 on every sync. Local to this workstation; never commit.'
    master_repo_path  = $MasterRootFull
    capabilities_path = (Join-Path $MasterRootFull 'config\capabilities.json')
    checker_path      = (Join-Path $MasterRootFull 'scripts\test-jmw-environment.ps1')
    reader_path       = (Join-Path $MasterRootFull 'scripts\get-jmw-capability.ps1')
} | ConvertTo-Json | Set-Content -Path (Join-Path $LocalDir 'jmw-master.json') -Encoding utf8

$LatestHandoff = $null
if ($ProjectSlug) {
    $Addendum = Join-Path $RepoRoot ("project-claude\{0}.md" -f $ProjectSlug)
    Copy-Item $ProfileFile (Join-Path $JmwDir 'PROJECT.md') -Force
    if (Test-Path $Addendum) { Copy-Item $Addendum (Join-Path $JmwDir 'CLAUDE-ADDENDUM.md') -Force }

    # Dated handoff snapshots from the master repo are always copied, read-only
    # reference, into .jmw/handoff-snapshots/. The newest one seeds .jmw/HANDOFF.md
    # only when the project does not have a HANDOFF.md yet (see below).
    $HandoffDir = Join-Path $RepoRoot 'projects\handoffs'
    if (Test-Path $HandoffDir) {
        $Snapshots = @(Get-ChildItem -Path $HandoffDir -Filter ("{0}-*.md" -f $ProjectSlug) -File | Sort-Object Name -Descending)
        if ($Snapshots.Count -gt 0) {
            $LatestHandoff = $Snapshots[0]
            $SnapshotDir = Join-Path $JmwDir 'handoff-snapshots'
            New-Item -ItemType Directory -Force -Path $SnapshotDir | Out-Null
            foreach ($Snap in $Snapshots) { Copy-Item $Snap.FullName (Join-Path $SnapshotDir $Snap.Name) -Force }
        }
    }
}

# ---------------------------------------------------------------------------
# Project state files. These belong to the PROJECT, not the master repo.
# They are created only when missing and are NEVER overwritten.
# ---------------------------------------------------------------------------
$StateTemplates = Join-Path $RepoRoot 'templates\jmw-state'
$Created = @()
$Kept = @()

function Install-IfMissing([string]$Source, [string]$Destination, [string]$Label) {
    if (Test-Path $Destination) {
        $script:Kept += $Label
    } else {
        Copy-Item $Source $Destination
        $script:Created += $Label
    }
}

foreach ($StateFile in @('STATUS.md', 'DECISIONS.md', 'OPEN-ISSUES.md', 'RUN-LOG.md')) {
    $Dest = Join-Path $JmwDir $StateFile
    $WasMissing = -not (Test-Path $Dest)
    Install-IfMissing (Join-Path $StateTemplates $StateFile) $Dest ".jmw\$StateFile"
    if ($WasMissing -and $ProjectSlug -and $StateFile -eq 'STATUS.md') {
        $Text = Get-Content $Dest -Raw
        $Text = $Text.Replace('- project: (project slug, e.g. lavish)', "- project: $ProjectSlug")
        Set-Content -Path $Dest -Value $Text -NoNewline
    }
}

$HandoffSource = Join-Path $StateTemplates 'HANDOFF.md'
if ($LatestHandoff) { $HandoffSource = $LatestHandoff.FullName }
Install-IfMissing $HandoffSource (Join-Path $JmwDir 'HANDOFF.md') '.jmw\HANDOFF.md'

$ArtifactsDir = Join-Path $JmwDir 'artifacts'
foreach ($Sub in @('screenshots', 'videos', 'qa-reports', 'evidence', 'logs')) {
    $SubDir = Join-Path $ArtifactsDir $Sub
    if (-not (Test-Path $SubDir)) {
        New-Item -ItemType Directory -Force -Path $SubDir | Out-Null
        $Created += ".jmw\artifacts\$Sub\"
    }
    $Keep = Join-Path $SubDir '.gitkeep'
    if (-not (Test-Path $Keep)) { New-Item -ItemType File -Path $Keep | Out-Null }
}
# Bot Ops state: run ledgers and human-gate packets belong to the project and are never
# overwritten. run-policy.json holds the project's preflight thresholds and timeout budgets.
foreach ($Sub in @('runs', 'gates')) {
    $SubDir = Join-Path $JmwDir $Sub
    if (-not (Test-Path $SubDir)) {
        New-Item -ItemType Directory -Force -Path $SubDir | Out-Null
        $Created += ".jmw\$Sub\"
    }
    $Keep = Join-Path $SubDir '.gitkeep'
    if (-not (Test-Path $Keep)) { New-Item -ItemType File -Path $Keep | Out-Null }
}
Install-IfMissing (Join-Path $StateTemplates 'run-policy.json') (Join-Path $JmwDir 'run-policy.json') '.jmw\run-policy.json'

# .jmw/.gitignore keeps workstation-local files and secrets out of git. Created when missing; when
# the project already has one, only the missing required lines are appended (nothing is removed).
$JmwIgnoreSource = Join-Path $StateTemplates '.gitignore'
$JmwIgnore = Join-Path $JmwDir '.gitignore'
if (-not (Test-Path $JmwIgnore)) {
    Copy-Item $JmwIgnoreSource $JmwIgnore
    $Created += '.jmw\.gitignore'
} else {
    $Have = @(Get-Content $JmwIgnore | ForEach-Object { $_.Trim() })
    $Missing = @(Get-Content $JmwIgnoreSource | Where-Object { $_.Trim() -and -not $_.StartsWith('#') -and ($Have -notcontains $_.Trim()) })
    if ($Missing.Count -gt 0) {
        Add-Content -Path $JmwIgnore -Value (@('', '# Added by install-jmw-agents.ps1 (JMW local files and secrets)') + $Missing)
        $Kept += ".jmw\.gitignore (added $($Missing.Count) line(s))"
    } else {
        $Kept += '.jmw\.gitignore'
    }
}

Install-IfMissing (Join-Path $StateTemplates 'artifacts\README.md') (Join-Path $ArtifactsDir 'README.md') '.jmw\artifacts\README.md'
Install-IfMissing (Join-Path $StateTemplates 'artifacts\.gitignore') (Join-Path $ArtifactsDir '.gitignore') '.jmw\artifacts\.gitignore'

Write-Host "JMW agents installed to $TargetAgents"
Write-Host "JMW command skills (jmw-*) installed to $(Join-Path $TargetPath '.claude\skills')"
Write-Host "JMW shared support bundle installed to $JmwDir"
if ($ProjectSlug) { Write-Host "Project profile installed for: $ProjectSlug" }
if ($LatestHandoff) { Write-Host "Handoff snapshots from master copied to .jmw\handoff-snapshots\ (newest: $($LatestHandoff.Name))" }
if ($Created.Count -gt 0) { Write-Host ("Created (were missing): " + ($Created -join ', ')) }
if ($Kept.Count -gt 0) { Write-Host ("Kept existing project state, not overwritten: " + ($Kept -join ', ')) }
Write-Host "Bot Ops scripts installed to $(Join-Path $JmwDir 'scripts') (run with: node .jmw/scripts/jmw-run.mjs ...; needs Node 22)"
Write-Host 'Capability pointer written to .jmw\local\jmw-master.json (local only; no capability state copied).'
Write-Host 'No existing CLAUDE.md was overwritten.'
