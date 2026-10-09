param(
    [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config\projects.local.json')
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Installer = Join-Path $PSScriptRoot 'install-jmw-agents.ps1'

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath. Copy config/projects.local.example.json to config/projects.local.json and add your local project paths."
}

$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
foreach ($project in $config.projects) {
    if ($project.enabled -eq $false) { continue }
    Write-Host "Syncing $($project.slug) -> $($project.path)"
    & $Installer -TargetPath $project.path -ProjectSlug $project.slug
}

Write-Host 'JMW sync complete.'
