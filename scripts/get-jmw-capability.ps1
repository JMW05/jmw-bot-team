#Requires -Version 7.0
<#
.SYNOPSIS
    Reads this workstation's JMW capability state and says whether it can be trusted. READ ONLY
    unless -Refresh is given (then it only reruns the read-only checker).

.DESCRIPTION
    The one place the freshness rule lives. The state file (config/capabilities.json in the
    master repo) is local to one workstation and never committed. It is usable only when:
    - it exists and parses, with schema_version 1;
    - generated_at is set and no older than -MaxAgeHours (default 24);
    - it was generated on the same OS as the machine reading it.
    Anything else is STALE/MISSING: do not route on it; refresh it or check ad hoc.

    In an installed project, pass -ProjectPath: the script finds the master repo through
    .jmw/local/jmw-master.json (written by install-jmw-agents.ps1 on every sync, never committed).

    Exit codes:
      0  state is fresh and the requested capability (if any) is ready
      1  state is fresh but the requested capability is not ready
      2  state is missing, unreadable, stale, from another OS, or the capability is unknown

.EXAMPLE
    pwsh -NoProfile -File scripts/get-jmw-capability.ps1 -Capability browser_qa
.EXAMPLE
    pwsh -NoProfile -File scripts/get-jmw-capability.ps1 -Capability game_qa -Refresh
.EXAMPLE
    pwsh -NoProfile -File C:\path\to\jmw-bot-team\scripts\get-jmw-capability.ps1 -ProjectPath . -Capability browser_qa
#>
[CmdletBinding()]
param(
    [string]$Capability,
    [string]$StatePath,
    [string]$ProjectPath,
    [int]$MaxAgeHours = 24,
    [switch]$Refresh,
    [datetime]$Now = (Get-Date).ToUniversalTime()
)

$ErrorActionPreference = 'Stop'
$MasterRoot = Split-Path -Parent $PSScriptRoot
$Checker = Join-Path $MasterRoot 'scripts/test-jmw-environment.ps1'

if (-not $StatePath -and $ProjectPath) {
    $Pointer = Join-Path $ProjectPath '.jmw/local/jmw-master.json'
    if (Test-Path -LiteralPath $Pointer) {
        $p = Get-Content -LiteralPath $Pointer -Raw | ConvertFrom-Json
        $StatePath = $p.capabilities_path
        if ($p.checker_path) { $Checker = $p.checker_path }
    }
}
if (-not $StatePath) { $StatePath = Join-Path $MasterRoot 'config/capabilities.json' }

function Get-Verdict {
    if (-not (Test-Path -LiteralPath $StatePath)) { return @{ code = 2; text = 'MISSING: no capability state on this workstation' } }
    try { $s = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json } catch { return @{ code = 2; text = 'MISSING: capability state is not valid JSON' } }
    if ($s.schema_version -ne 1) { return @{ code = 2; text = "MISSING: unsupported schema_version '$($s.schema_version)'" } }
    if (-not $s.generated_at) { return @{ code = 2; text = 'MISSING: baseline only, the checker has never run here' } }

    # ConvertFrom-Json may already have turned the ISO string into a DateTime.
    $g = $s.generated_at
    $generated = if ($g -is [datetime]) { $g.ToUniversalTime() } else {
        [datetime]::Parse($g, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
    }
    $stamp = $generated.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $age = $Now.ToUniversalTime() - $generated
    $ageText = '{0:N1}h old' -f $age.TotalHours
    if ($age.TotalHours -gt $MaxAgeHours) { return @{ code = 2; text = "STALE: generated $stamp ($ageText, limit ${MaxAgeHours}h)" } }

    $os = if ($IsWindows) { 'Windows' } elseif ($IsMacOS) { 'macOS' } elseif ($IsLinux) { 'Linux' } else { 'unknown' }
    if ($s.host.os -ne $os) { return @{ code = 2; text = "STALE: generated on $($s.host.os), this machine is $os" } }

    if (-not $Capability) { return @{ code = 0; text = "FRESH: generated $stamp ($ageText)" } }
    $c = $s.capabilities.$Capability
    if ($null -eq $c) { return @{ code = 2; text = "UNKNOWN: no capability named '$Capability' (see docs/CAPABILITIES.md)" } }
    if ($c.ready) { return @{ code = 0; text = "READY: $Capability (state $ageText)" } }
    return @{ code = 1; text = "NOT READY: $Capability missing $(@($c.missing) -join ', ') (state $ageText)" }
}

$v = Get-Verdict
if ($v.code -eq 2 -and $Refresh -and -not $v.text.StartsWith('UNKNOWN')) {
    if (-not (Test-Path -LiteralPath $Checker)) { Write-Host "$($v.text). Checker not found, so check the tool directly and label it ad hoc."; exit 2 }
    Write-Host "$($v.text). Refreshing with the read-only checker..."
    & pwsh -NoProfile -File $Checker -OutputPath $StatePath | Out-Null
    $Now = (Get-Date).ToUniversalTime()
    $v = Get-Verdict
}
Write-Host $v.text
exit $v.code
