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
Install-IfMissing (Join-Path $StateTemplates 'artifacts\README.md') (Join-Path $ArtifactsDir 'README.md') '.jmw\artifacts\README.md'
Install-IfMissing (Join-Path $StateTemplates 'artifacts\.gitignore') (Join-Path $ArtifactsDir '.gitignore') '.jmw\artifacts\.gitignore'

Write-Host "JMW agents installed to $TargetAgents"
Write-Host "JMW command skills (jmw-*) installed to $(Join-Path $TargetPath '.claude\skills')"
Write-Host "JMW shared support bundle installed to $JmwDir"
if ($ProjectSlug) { Write-Host "Project profile installed for: $ProjectSlug" }
if ($LatestHandoff) { Write-Host "Handoff snapshots from master copied to .jmw\handoff-snapshots\ (newest: $($LatestHandoff.Name))" }
if ($Created.Count -gt 0) { Write-Host ("Created (were missing): " + ($Created -join ', ')) }
if ($Kept.Count -gt 0) { Write-Host ("Kept existing project state, not overwritten: " + ($Kept -join ', ')) }
Write-Host 'No existing CLAUDE.md was overwritten.'
