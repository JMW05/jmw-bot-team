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

if ($ProjectSlug) {
    $Profile = Join-Path $RepoRoot ("projects\{0}.md" -f $ProjectSlug)
    $Addendum = Join-Path $RepoRoot ("project-claude\{0}.md" -f $ProjectSlug)
    if (-not (Test-Path $Profile)) { throw "Unknown project profile: $ProjectSlug" }
    Copy-Item $Profile (Join-Path $JmwDir 'PROJECT.md') -Force
    if (Test-Path $Addendum) { Copy-Item $Addendum (Join-Path $JmwDir 'CLAUDE-ADDENDUM.md') -Force }
}

Write-Host "JMW agents installed to $TargetAgents"
if ($ProjectSlug) { Write-Host "Project profile installed for: $ProjectSlug" }
Write-Host 'No existing CLAUDE.md was overwritten.'
