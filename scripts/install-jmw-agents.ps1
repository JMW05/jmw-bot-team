param(
    [Parameter(Mandatory=$true)][string]$TargetPath,
    [Parameter(Mandatory=$false)][string]$ProjectSlug
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$SourceAgents = Join-Path $RepoRoot '.claude\agents'

if (-not (Test-Path $TargetPath)) { throw "TargetPath does not exist: $TargetPath" }
if (-not (Test-Path $SourceAgents)) { throw "Source agents folder not found: $SourceAgents" }

$TargetAgents = Join-Path $TargetPath '.claude\agents'
New-Item -ItemType Directory -Force -Path $TargetAgents | Out-Null
Copy-Item -Path (Join-Path $SourceAgents '*.md') -Destination $TargetAgents -Force

$JmwDir = Join-Path $TargetPath '.jmw'
New-Item -ItemType Directory -Force -Path $JmwDir | Out-Null

# Install the shared JMW support bundle into .jmw so synced agents can always
# find their standards, checklists, workflows, and report template without
# polluting or overwriting the target project's own root files.
$SharedFolders = @('standards', 'checklists', 'workflows')
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

$ReportTemplate = Join-Path $RepoRoot 'templates\reports\JMW-REVIEW.md'
if (Test-Path $ReportTemplate) {
    $TargetReportDir = Join-Path $JmwDir 'templates\reports'
    New-Item -ItemType Directory -Force -Path $TargetReportDir | Out-Null
    Copy-Item $ReportTemplate (Join-Path $TargetReportDir 'JMW-REVIEW.md') -Force
}

# JMW skills (/jmw-review, /jmw-owner-ready, ...) are framework-owned like the
# agents, so they are refreshed on every sync. Only jmw-* skill folders are
# touched; any other skills the project has are left alone.
$SourceSkills = Join-Path $RepoRoot '.claude\skills'
$InstalledSkills = @()
if (Test-Path $SourceSkills) {
    $TargetSkills = Join-Path $TargetPath '.claude\skills'
    New-Item -ItemType Directory -Force -Path $TargetSkills | Out-Null
    foreach ($SkillDir in Get-ChildItem -Path $SourceSkills -Directory -Filter 'jmw-*') {
        $TargetSkillDir = Join-Path $TargetSkills $SkillDir.Name
        New-Item -ItemType Directory -Force -Path $TargetSkillDir | Out-Null
        Copy-Item -Path (Join-Path $SkillDir.FullName '*') -Destination $TargetSkillDir -Recurse -Force
        $InstalledSkills += $SkillDir.Name
    }
}

# Project state files belong to the project, not the framework. Create them
# only when absent and never overwrite them, so progress, decisions, and
# issues survive every re-sync. The templates themselves are refreshed under
# .jmw/templates/jmw-state so agents always know the current block formats.
$StateTemplates = Join-Path $RepoRoot 'templates\jmw-state'
$StateCreated = @()
$StateKept = @()
if (Test-Path $StateTemplates) {
    $TargetStateTemplates = Join-Path $JmwDir 'templates\jmw-state'
    New-Item -ItemType Directory -Force -Path $TargetStateTemplates | Out-Null
    Copy-Item -Path (Join-Path $StateTemplates '*') -Destination $TargetStateTemplates -Recurse -Force

    $Slug = if ($ProjectSlug) { $ProjectSlug } else { 'unknown' }
    $Today = Get-Date -Format 'yyyy-MM-dd'
    foreach ($StateName in @('STATUS.md', 'DECISIONS.md', 'OPEN-ISSUES.md', 'HANDOFF.md', 'RUN-LOG.md')) {
        $TargetState = Join-Path $JmwDir $StateName
        if (Test-Path $TargetState) { $StateKept += $StateName; continue }
        $Content = Get-Content -Path (Join-Path $StateTemplates $StateName) -Raw
        $Content = $Content.Replace('{{PROJECT_SLUG}}', $Slug).Replace('{{INSTALL_DATE}}', $Today)
        Set-Content -Path $TargetState -Value $Content -NoNewline -Encoding utf8
        $StateCreated += $StateName
    }

    # Evidence folders. Existing artifacts and an existing README/.gitignore
    # are never replaced.
    $ArtifactsDir = Join-Path $JmwDir 'artifacts'
    foreach ($Sub in @('screenshots', 'videos', 'qa-reports', 'evidence', 'logs')) {
        $SubDir = Join-Path $ArtifactsDir $Sub
        New-Item -ItemType Directory -Force -Path $SubDir | Out-Null
        $Keep = Join-Path $SubDir '.gitkeep'
        if (-not (Test-Path $Keep)) { New-Item -ItemType File -Path $Keep | Out-Null }
    }
    $ArtifactsReadme = Join-Path $ArtifactsDir 'README.md'
    if (-not (Test-Path $ArtifactsReadme)) { Copy-Item (Join-Path $StateTemplates 'artifacts\README.md') $ArtifactsReadme }
    $ArtifactsIgnore = Join-Path $ArtifactsDir '.gitignore'
    if (-not (Test-Path $ArtifactsIgnore)) { Copy-Item (Join-Path $StateTemplates 'artifacts\gitignore') $ArtifactsIgnore }
}

if ($ProjectSlug) {
    $Profile = Join-Path $RepoRoot ("projects\{0}.md" -f $ProjectSlug)
    $Addendum = Join-Path $RepoRoot ("project-claude\{0}.md" -f $ProjectSlug)
    if (-not (Test-Path $Profile)) { throw "Unknown project profile: $ProjectSlug" }
    Copy-Item $Profile (Join-Path $JmwDir 'PROJECT.md') -Force
    if (Test-Path $Addendum) { Copy-Item $Addendum (Join-Path $JmwDir 'CLAUDE-ADDENDUM.md') -Force }

    # Dated handoff snapshots from the master repo are background history.
    # They are copied into .jmw/handoffs/ (refreshed each sync). They no longer
    # overwrite .jmw/HANDOFF.md, which is now the project's own live session
    # handoff written by the Project Manager. The Project Manager reads the
    # newest snapshot in .jmw/handoffs/ for inherited context.
    $HandoffDir = Join-Path $RepoRoot 'projects\handoffs'
    $LatestHandoff = $null
    if (Test-Path $HandoffDir) {
        $Snapshots = Get-ChildItem -Path $HandoffDir -Filter ("{0}-*.md" -f $ProjectSlug) -File
        if ($Snapshots) {
            $TargetHandoffs = Join-Path $JmwDir 'handoffs'
            New-Item -ItemType Directory -Force -Path $TargetHandoffs | Out-Null
            foreach ($Snapshot in $Snapshots) {
                Copy-Item $Snapshot.FullName (Join-Path $TargetHandoffs $Snapshot.Name) -Force
            }
            $LatestHandoff = $Snapshots | Sort-Object Name -Descending | Select-Object -First 1
        }
    }
}

Write-Host "JMW agents installed to $TargetAgents"
if ($InstalledSkills.Count -gt 0) { Write-Host ("JMW skills installed: {0}" -f ($InstalledSkills -join ', ')) }
Write-Host "JMW shared support bundle installed to $JmwDir"
if ($ProjectSlug) { Write-Host "Project profile installed for: $ProjectSlug" }
if ($LatestHandoff) { Write-Host ("Latest master handoff snapshot available at .jmw\handoffs\{0}" -f $LatestHandoff.Name) }
if ($StateCreated.Count -gt 0) { Write-Host ("Project state files created: {0}" -f ($StateCreated -join ', ')) }
if ($StateKept.Count -gt 0) { Write-Host ("Existing project state kept unchanged: {0}" -f ($StateKept -join ', ')) }
Write-Host 'No existing CLAUDE.md was overwritten.'
