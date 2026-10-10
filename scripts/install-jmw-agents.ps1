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

if ($ProjectSlug) {
    $Profile = Join-Path $RepoRoot ("projects\{0}.md" -f $ProjectSlug)
    $Addendum = Join-Path $RepoRoot ("project-claude\{0}.md" -f $ProjectSlug)
    if (-not (Test-Path $Profile)) { throw "Unknown project profile: $ProjectSlug" }
    Copy-Item $Profile (Join-Path $JmwDir 'PROJECT.md') -Force
    if (Test-Path $Addendum) { Copy-Item $Addendum (Join-Path $JmwDir 'CLAUDE-ADDENDUM.md') -Force }

    # If one or more dated handoff snapshots exist for this project, install
    # the newest one as .jmw/HANDOFF.md so agents inherit the latest verified
    # project history and unresolved work instead of starting from scratch.
    $HandoffDir = Join-Path $RepoRoot 'projects\handoffs'
    if (Test-Path $HandoffDir) {
        $LatestHandoff = Get-ChildItem -Path $HandoffDir -Filter ("{0}-*.md" -f $ProjectSlug) -File |
            Sort-Object Name -Descending |
            Select-Object -First 1
        if ($LatestHandoff) {
            Copy-Item $LatestHandoff.FullName (Join-Path $JmwDir 'HANDOFF.md') -Force
        }
    }
}

Write-Host "JMW agents installed to $TargetAgents"
Write-Host "JMW shared support bundle installed to $JmwDir"
if ($ProjectSlug) { Write-Host "Project profile installed for: $ProjectSlug" }
if (Test-Path (Join-Path $JmwDir 'HANDOFF.md')) { Write-Host 'Latest project handoff installed as .jmw\HANDOFF.md' }
Write-Host 'No existing CLAUDE.md was overwritten.'
