#Requires -Version 7.0
<#
.SYNOPSIS
    JMW environment / capability checker. READ ONLY.

.DESCRIPTION
    Detects which local tools and Claude Code MCP servers are actually usable on
    this workstation, prints a human-readable summary, and writes structured state
    to config/capabilities.json so the JMW Project Manager can decide what work
    can really be tested, built, inspected, recorded, or automated.

    Versions are detected on every run; nothing here is hardcoded as truth.

    Safety:
    - Never prints or stores secrets, tokens, environment-variable values, MCP
      commands/URLs/arguments, or install paths.
    - Never modifies MCP configuration, installs packages, or authenticates.
    - Never launches desktop GUI applications (Krita, Audacity, DBeaver).
    - `claude mcp list` output is reduced to server names and a normalized status.
    - `gh auth status` output is discarded; only its exit code is used.
    - The Godot headless probe runs in an empty temporary folder so it cannot
      touch a project, and the folder is removed afterwards.

.PARAMETER OutputPath
    Where to write the JSON state. Defaults to config/capabilities.json in this repo.

.PARAMETER NoWrite
    Print the summary only; do not write JSON.

.PARAMETER SkipMcp
    Do not run `claude mcp list` (MCP states are recorded as unknown).

.PARAMETER SkipGodotHeadless
    Do not run the Godot headless launch probe.

.PARAMETER GodotPath
    Optional explicit path to the Godot executable if it is not on PATH.

.EXAMPLE
    pwsh -NoProfile -File scripts/test-jmw-environment.ps1
#>
[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config/capabilities.json'),
    [switch]$NoWrite,
    [switch]$SkipMcp,
    [switch]$SkipGodotHeadless,
    [string]$GodotPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Runs an executable with a timeout and captured output. Output is returned to
# the caller for parsing only; callers decide what (if anything) is displayed.
function Invoke-Tool {
    param(
        [Parameter(Mandatory)][string]$Path,
        [string[]]$Arguments = @(),
        [int]$TimeoutSec = 20,
        [string]$WorkingDirectory
    )
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($IsWindows -and ($ext -eq '.cmd' -or $ext -eq '.bat')) {
        $psi.FileName = 'cmd.exe'
        foreach ($a in @('/d', '/c', $Path) + $Arguments) { $psi.ArgumentList.Add($a) }
    } else {
        $psi.FileName = $Path
        foreach ($a in $Arguments) { $psi.ArgumentList.Add($a) }
    }
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    if ($WorkingDirectory) { $psi.WorkingDirectory = $WorkingDirectory }

    $result = [ordered]@{ Started = $false; ExitCode = $null; StdOut = ''; StdErr = ''; TimedOut = $false }
    try {
        $p = [System.Diagnostics.Process]::Start($psi)
    } catch {
        return [pscustomobject]$result
    }
    $result.Started = $true
    try { $p.StandardInput.Close() } catch { }
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        $result.TimedOut = $true
        try { $p.Kill($true) } catch { }
        $null = $p.WaitForExit(5000)
    } else {
        $p.WaitForExit()
        $result.ExitCode = $p.ExitCode
    }
    try { $result.StdOut = $outTask.GetAwaiter().GetResult() } catch { }
    try { $result.StdErr = $errTask.GetAwaiter().GetResult() } catch { }
    $p.Dispose()
    return [pscustomobject]$result
}

# Resolves the first real executable (not a PowerShell alias/function/script)
# for any of the given command names.
function Find-Executable {
    param([string[]]$Names)
    foreach ($n in $Names) {
        $cmd = Get-Command -Name $n -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

# Pulls a version string out of the first non-empty output line.
function Get-VersionFromText {
    param([string]$Text, [string]$Pattern)
    if (-not $Text) { return $null }
    $line = ($Text -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
    if (-not $line) { return $null }
    if ($Pattern -and $line -match $Pattern) { return $Matches[1] }
    if ($line -match '(\d+\.\d+(?:\.\d+)?(?:[-.][0-9A-Za-z]+)*)') { return $Matches[1] }
    return $null
}

function New-LocalResult {
    param([string]$Label, [string]$Group, [bool]$Required)
    [ordered]@{
        label     = $Label
        group     = $Group
        required  = $Required
        available = $false
        version   = $null
        note      = $null
    }
}

# Checks a command-line tool: found on PATH, runs successfully, reports a version.
function Test-CommandTool {
    param(
        [string]$Label,
        [string]$Group,
        [bool]$Required,
        [string[]]$Names,
        [string[]]$VersionArgs = @('--version'),
        [string]$VersionPattern,
        [string]$ExplicitPath
    )
    $r = New-LocalResult -Label $Label -Group $Group -Required $Required
    $exe = $null
    if ($ExplicitPath) {
        if (Test-Path -LiteralPath $ExplicitPath -PathType Leaf) { $exe = $ExplicitPath }
        else { $r.note = 'explicit path not found' }
    }
    if (-not $exe) { $exe = Find-Executable -Names $Names }
    if (-not $exe) {
        if (-not $r.note) { $r.note = 'not found on PATH' }
        return $r
    }
    $run = Invoke-Tool -Path $exe -Arguments $VersionArgs -TimeoutSec 20
    if (-not $run.Started) { $r.note = 'found but could not be started'; return $r }
    if ($run.TimedOut) { $r.note = 'found but version check timed out'; return $r }
    if ($run.ExitCode -ne 0) {
        # e.g. the Windows Store "python" alias, which exits non-zero.
        $r.note = 'found but did not run successfully'
        return $r
    }
    $r.available = $true
    $text = if ($run.StdOut.Trim()) { $run.StdOut } else { $run.StdErr }
    $r.version = Get-VersionFromText -Text $text -Pattern $VersionPattern
    if (-not $r.version) { $r.note = 'version not detected' }
    return $r
}

# Detects a desktop GUI app without launching it: PATH, Windows uninstall
# registry entries, then common install locations. Paths are never reported.
function Test-DesktopApp {
    param(
        [string]$Label,
        [string]$Group,
        [string[]]$CommandNames,
        [string]$RegistryPattern,
        [string[]]$WindowsPaths = @(),
        [string[]]$UnixPaths = @()
    )
    $r = New-LocalResult -Label $Label -Group $Group -Required $false
    $r['detected_via'] = $null

    if ($IsWindows) {
        $keys = @(
            'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
        )
        $entry = Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
            Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -match $RegistryPattern } |
            Select-Object -First 1
        if ($entry) {
            $r.available = $true
            $r.detected_via = 'registry'
            if ($entry.PSObject.Properties['DisplayVersion'] -and $entry.DisplayVersion) { $r.version = [string]$entry.DisplayVersion }
            $r['product'] = [string]$entry.DisplayName
            return $r
        }
    }

    $candidates = if ($IsWindows) { $WindowsPaths } else { $UnixPaths }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            $r.available = $true
            $r.detected_via = 'install-location'
            if ($IsWindows -and (Test-Path -LiteralPath $c -PathType Leaf)) {
                $v = (Get-Item -LiteralPath $c).VersionInfo.ProductVersion
                if ($v) { $r.version = $v.Trim() }
            }
            return $r
        }
    }

    if (Find-Executable -Names $CommandNames) {
        $r.available = $true
        $r.detected_via = 'path'
        return $r
    }

    $r.note = 'not detected (checked PATH, registry and common install locations)'
    return $r
}

# Normalizes one status phrase from `claude mcp list`.
function ConvertTo-McpState {
    param([string]$Phrase)
    switch -Regex ($Phrase) {
        '^connected'                 { return @{ status = 'connected';               detail = 'connected' } }
        'needs? auth|authenticat'    { return @{ status = 'authentication_required'; detail = 'needs_authentication' } }
        'failed'                     { return @{ status = 'unavailable';             detail = 'failed_to_connect' } }
        'timed out|timeout'          { return @{ status = 'unavailable';             detail = 'timed_out' } }
        'not configured|disabled'    { return @{ status = 'unavailable';             detail = 'not_configured' } }
        default                      { return @{ status = 'unknown';                 detail = 'unrecognized_status' } }
    }
}

# Parses `claude mcp list` into name + normalized status only. The command,
# URL and any arguments between the name and the status are discarded.
function ConvertFrom-McpList {
    param([string]$Text)
    $servers = [System.Collections.Generic.List[object]]::new()
    $statusRx = [regex]'(?i)\s-\s+(?:\S{1,4}\s+)?(connected|needs authentication|needs auth\w*|failed to connect|request timed out|timed out|not configured|disabled|pending|connecting)\b'
    foreach ($line in ($Text -split "`r?`n")) {
        $t = $line.Trim()
        if (-not $t) { continue }
        if ($t -match '^(?i)checking mcp server health') { continue }
        $idx = $t.IndexOf(': ')
        if ($idx -lt 1) { continue }
        $name = $t.Substring(0, $idx).Trim()
        $m = $statusRx.Matches($t)
        if ($m.Count -gt 0) {
            $state = ConvertTo-McpState -Phrase $m[$m.Count - 1].Groups[1].Value
        } else {
            $state = @{ status = 'unknown'; detail = 'unrecognized_status' }
        }
        $servers.Add([ordered]@{ name = $name; status = $state.status; detail = $state.detail })
    }
    return , $servers
}

# ---------------------------------------------------------------------------
# Local tools
# ---------------------------------------------------------------------------

$local = [ordered]@{}

$local['pwsh']        = Test-CommandTool -Label 'PowerShell 7'   -Group 'CORE'    -Required $true  -Names @('pwsh') -VersionPattern 'PowerShell\s+(\S+)'
$local['claude_code'] = Test-CommandTool -Label 'Claude Code'    -Group 'CORE'    -Required $true  -Names @('claude')
$local['git']         = Test-CommandTool -Label 'Git'            -Group 'CORE'    -Required $true  -Names @('git') -VersionPattern 'git version\s+(\S+)'
$local['gh']          = Test-CommandTool -Label 'GitHub CLI'     -Group 'CORE'    -Required $true  -Names @('gh') -VersionPattern 'gh version\s+(\S+)'
$local['node']        = Test-CommandTool -Label 'Node'           -Group 'CORE'    -Required $true  -Names @('node') -VersionPattern 'v?(\d+\.\d+\.\d+)'
$local['npm']         = Test-CommandTool -Label 'npm'            -Group 'CORE'    -Required $true  -Names @('npm')
$local['python']      = Test-CommandTool -Label 'Python'         -Group 'CORE'    -Required $true  -Names @('python', 'python3') -VersionPattern 'Python\s+(\S+)'
$local['py']          = Test-CommandTool -Label 'Python launcher (py)' -Group 'CORE' -Required $false -Names @('py') -VersionPattern 'Python\s+(\S+)'

# Python is satisfied by either `python` or the Windows `py` launcher.
if (-not $local['python'].available -and $local['py'].available) {
    $local['python'].available = $true
    $local['python'].version = $local['py'].version
    $local['python'].note = 'available via py launcher'
}

# GitHub CLI authentication: exit code only, output discarded (it can name the
# account and masked token details).
$local['gh']['authenticated'] = $null
if ($local['gh'].available) {
    $ghExe = Find-Executable -Names @('gh')
    $auth = Invoke-Tool -Path $ghExe -Arguments @('auth', 'status') -TimeoutSec 20
    $local['gh']['authenticated'] = ($auth.Started -and -not $auth.TimedOut -and $auth.ExitCode -eq 0)
}

$local['ffmpeg']  = Test-CommandTool -Label 'FFmpeg'      -Group 'MEDIA'   -Required $false -Names @('ffmpeg') -VersionArgs @('-version') -VersionPattern 'ffmpeg version\s+(\S+)'
$local['magick']  = Test-CommandTool -Label 'ImageMagick' -Group 'MEDIA'   -Required $false -Names @('magick') -VersionArgs @('-version') -VersionPattern 'ImageMagick\s+(\S+)'
$local['rg']      = Test-CommandTool -Label 'ripgrep'     -Group 'UTILITY' -Required $false -Names @('rg') -VersionPattern 'ripgrep\s+(\S+)'
$local['jq']      = Test-CommandTool -Label 'jq'          -Group 'UTILITY' -Required $false -Names @('jq') -VersionPattern 'jq-(\S+)'

$local['godot'] = Test-CommandTool -Label 'Godot' -Group 'GAME' -Required $false -Names @('godot', 'godot4') -VersionPattern '(\d+\.\d+(?:\.\d+)?)' -ExplicitPath $GodotPath
$local['godot']['headless_verified'] = $false
$local['godot']['headless_note'] = $null
if (-not $local['godot'].available) {
    $local['godot'].headless_note = 'godot not available'
} elseif ($SkipGodotHeadless) {
    $local['godot'].headless_verified = $null
    $local['godot'].headless_note = 'skipped (-SkipGodotHeadless)'
} else {
    $godotExe = if ($GodotPath -and (Test-Path -LiteralPath $GodotPath -PathType Leaf)) { $GodotPath } else { Find-Executable -Names @('godot', 'godot4') }
    # Empty scratch folder so the editor launch can never open or import a real project.
    $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('jmw-godot-probe-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $scratch -Force | Out-Null
    try {
        $probe = Invoke-Tool -Path $godotExe -Arguments @('--headless', '--editor', '--quit') -TimeoutSec 90 -WorkingDirectory $scratch
        if ($probe.TimedOut) { $local['godot'].headless_note = 'headless launch timed out' }
        elseif (-not $probe.Started) { $local['godot'].headless_note = 'headless launch could not start' }
        elseif ($probe.ExitCode -ne 0) { $local['godot'].headless_note = "headless launch exited with code $($probe.ExitCode)" }
        else { $local['godot'].headless_verified = $true }
    } finally {
        Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$pf   = $env:ProgramFiles
$pf86 = ${env:ProgramFiles(x86)}
$lad  = $env:LOCALAPPDATA
function Join-IfSet([string]$Base, [string]$Child) { if ($Base) { Join-Path $Base $Child } }

$local['krita'] = Test-DesktopApp -Label 'Krita' -Group 'MEDIA' -CommandNames @('krita') -RegistryPattern '^Krita' `
    -WindowsPaths @((Join-IfSet $pf 'Krita (x64)\bin\krita.exe'), (Join-IfSet $pf 'Krita\bin\krita.exe')) `
    -UnixPaths @('/Applications/krita.app', '/Applications/Krita.app', '/usr/bin/krita', '/usr/local/bin/krita')
$local['audacity'] = Test-DesktopApp -Label 'Audacity' -Group 'MEDIA' -CommandNames @('audacity') -RegistryPattern '^Audacity' `
    -WindowsPaths @((Join-IfSet $pf 'Audacity\Audacity.exe'), (Join-IfSet $pf86 'Audacity\Audacity.exe')) `
    -UnixPaths @('/Applications/Audacity.app', '/usr/bin/audacity', '/usr/local/bin/audacity')
$local['dbeaver'] = Test-DesktopApp -Label 'DBeaver' -Group 'DATABASE' -CommandNames @('dbeaver') -RegistryPattern '^DBeaver' `
    -WindowsPaths @((Join-IfSet $pf 'DBeaver\dbeaver.exe'), (Join-IfSet $lad 'DBeaver\dbeaver.exe'), (Join-IfSet $lad 'Programs\DBeaver\dbeaver.exe')) `
    -UnixPaths @('/Applications/DBeaver.app', '/usr/bin/dbeaver', '/usr/share/dbeaver-ce/dbeaver', '/snap/bin/dbeaver-ce')

# ---------------------------------------------------------------------------
# MCP servers
# ---------------------------------------------------------------------------

# Capability key -> label, group, and patterns matched against server names
# (lowercased, non-alphanumerics removed). Several servers can match one key
# (e.g. multiple Gmail plugins); the best state wins.
$mcpTargets = [ordered]@{
    playwright      = @{ label = 'Playwright MCP';      group = 'QA / BROWSER'; patterns = @('playwright') }
    chrome_devtools = @{ label = 'Chrome DevTools MCP'; group = 'QA / BROWSER'; patterns = @('chromedevtools') }
    supabase        = @{ label = 'Supabase';            group = 'CONNECTORS';   patterns = @('supabase') }
    netlify         = @{ label = 'Netlify';             group = 'CONNECTORS';   patterns = @('netlify') }
    vercel          = @{ label = 'Vercel';              group = 'CONNECTORS';   patterns = @('vercel') }
    quickbooks      = @{ label = 'QuickBooks';          group = 'CONNECTORS';   patterns = @('quickbooks') }
    gmail           = @{ label = 'Gmail';               group = 'CONNECTORS';   patterns = @('gmail') }
    google_drive    = @{ label = 'Google Drive';        group = 'CONNECTORS';   patterns = @('googledrive') }
    google_calendar = @{ label = 'Google Calendar';     group = 'CONNECTORS';   patterns = @('googlecalendar') }
}
$stateRank = @{ connected = 4; authentication_required = 3; unknown = 2; unavailable = 1 }

$mcpListing = [ordered]@{ ran = $false; note = $null; server_count = 0; servers = @() }
$servers = $null
if ($SkipMcp) {
    $mcpListing.note = 'skipped (-SkipMcp)'
} elseif (-not $local['claude_code'].available) {
    $mcpListing.note = 'claude CLI not available'
} else {
    $claudeExe = Find-Executable -Names @('claude')
    $list = Invoke-Tool -Path $claudeExe -Arguments @('mcp', 'list') -TimeoutSec 120
    if ($list.TimedOut) { $mcpListing.note = 'claude mcp list timed out' }
    elseif (-not $list.Started -or $list.ExitCode -ne 0) { $mcpListing.note = 'claude mcp list did not run successfully' }
    else {
        $servers = ConvertFrom-McpList -Text $list.StdOut
        $mcpListing.ran = $true
        $mcpListing.server_count = $servers.Count
        $mcpListing.servers = @($servers)
    }
}

$mcp = [ordered]@{}
foreach ($key in $mcpTargets.Keys) {
    $t = $mcpTargets[$key]
    $entry = [ordered]@{ label = $t.label; group = $t.group; status = 'unknown'; detail = $null; matched_servers = @() }
    if (-not $mcpListing.ran) {
        $entry.detail = if ($mcpListing.note) { $mcpListing.note } else { 'not checked' }
    } else {
        $matched = @($servers | Where-Object {
            $norm = ($_.name.ToLowerInvariant() -replace '[^a-z0-9]', '')
            foreach ($p in $t.patterns) { if ($norm.Contains($p)) { return $true } }
            return $false
        })
        if ($matched.Count -eq 0) {
            $entry.status = 'unavailable'
            $entry.detail = 'not_listed'
        } else {
            $best = $matched | Sort-Object { $stateRank[$_.status] } -Descending | Select-Object -First 1
            $entry.status = $best.status
            $entry.detail = $best.detail
            $entry.matched_servers = @($matched | ForEach-Object { [ordered]@{ name = $_.name; status = $_.status } })
        }
    }
    $mcp[$key] = $entry
}

# ---------------------------------------------------------------------------
# Task capabilities (what the Project Manager routes on)
# ---------------------------------------------------------------------------

# Requirement syntax: local:<key> (tool available), local:godot:headless,
# local:gh:auth, mcp:<key> (status connected).
$capabilityDefs = [ordered]@{
    github_operations      = @{ description = 'GitHub repo/PR operations from the CLI'; requires = @('local:git', 'local:gh', 'local:gh:auth') }
    website_build          = @{ description = 'Build/run a JS website locally';          requires = @('local:git', 'local:node', 'local:npm') }
    browser_qa             = @{ description = 'Automated browser QA';                    requires = @('mcp:playwright') }
    deep_browser_debugging = @{ description = 'Console/network/performance debugging';   requires = @('mcp:chrome_devtools') }
    game_qa                = @{ description = 'Godot project checks and headless runs';  requires = @('local:godot', 'local:godot:headless') }
    gameplay_capture       = @{ description = 'Record/encode gameplay footage';          requires = @('local:godot', 'local:ffmpeg') }
    image_cleanup          = @{ description = 'Scripted image conversion/cleanup';       requires = @('local:magick') }
    media_processing       = @{ description = 'Audio/video transcode and trim';          requires = @('local:ffmpeg') }
    python_scripting       = @{ description = 'Run Python helper scripts';               requires = @('local:python') }
    finance_review         = @{ description = 'Review supplied finance files (read-only)'; requires = @() }
    quickbooks_data        = @{ description = 'Read QuickBooks data via connector';      requires = @('mcp:quickbooks') }
    supabase_ops           = @{ description = 'Inspect Supabase projects via connector'; requires = @('mcp:supabase') }
    netlify_ops            = @{ description = 'Inspect Netlify sites via connector';     requires = @('mcp:netlify') }
    vercel_ops             = @{ description = 'Inspect Vercel projects via connector';   requires = @('mcp:vercel') }
}

function Test-Requirement([string]$Req) {
    $parts = $Req -split ':'
    switch ($parts[0]) {
        'local' {
            $item = $local[$parts[1]]
            if (-not $item) { return $false }
            if ($parts.Count -eq 3 -and $parts[2] -eq 'headless') { return ($item.headless_verified -eq $true) }
            if ($parts.Count -eq 3 -and $parts[2] -eq 'auth')     { return ($item.authenticated -eq $true) }
            return [bool]$item.available
        }
        'mcp' { return ($mcp[$parts[1]] -and $mcp[$parts[1]].status -eq 'connected') }
    }
    return $false
}

$capabilities = [ordered]@{}
foreach ($key in $capabilityDefs.Keys) {
    $d = $capabilityDefs[$key]
    $missing = @($d.requires | Where-Object { -not (Test-Requirement $_) })
    $capabilities[$key] = [ordered]@{
        description = $d.description
        requires    = @($d.requires)
        ready       = ($missing.Count -eq 0)
        missing     = $missing
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

$requiredItems = @($local.Values | Where-Object { $_.required })
$optionalLocal = @($local.Values | Where-Object { -not $_.required })
$requiredOk = @($requiredItems | Where-Object { $_.available }).Count
$optionalTotal = $optionalLocal.Count + $mcp.Count + 1   # +1 for Godot headless
$optionalOk = @($optionalLocal | Where-Object { $_.available }).Count +
              @($mcp.Values | Where-Object { $_.status -eq 'connected' }).Count +
              [int]($local['godot'].headless_verified -eq $true)
$blocking = @($requiredItems | Where-Object { -not $_.available } | ForEach-Object { "$($_.label) missing" })

$summary = [ordered]@{
    required_available = $requiredOk
    required_total     = $requiredItems.Count
    optional_available = $optionalOk
    optional_total     = $optionalTotal
    blocking_issues    = $blocking
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

function Write-Row([string]$State, [string]$Label, [string]$Info) {
    $color = switch ($State) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } 'FAIL' { 'Red' } default { 'Gray' } }
    Write-Host ('{0,-5} ' -f $State) -ForegroundColor $color -NoNewline
    Write-Host ('{0,-22} {1}' -f $Label, $Info).TrimEnd()
}

function Get-LocalRow($item) {
    if ($item.available) {
        $info = if ($item.version) { $item.version } else { '' }
        if ($item.Contains('product') -and $item.product) { $info = ("$($item.product) $info").Trim() }
        if ($item.note -and -not $item.version) { $info = ("$info ($($item.note))").Trim() }
        return @('PASS', $item.label, $info)
    }
    $state = if ($item.required) { 'FAIL' } else { 'WARN' }
    return @($state, $item.label, $item.note)
}

Write-Host ''
Write-Host 'JMW CAPABILITY CHECK'
Write-Host ("Generated {0}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))

$sections = [ordered]@{
    'CORE'         = @('pwsh', 'claude_code', 'git', 'gh', 'node', 'npm', 'python', 'py')
    'QA / BROWSER' = @()
    'MEDIA'        = @('ffmpeg', 'magick', 'krita', 'audacity')
    'UTILITY'      = @('rg', 'jq')
    'GAME'         = @('godot')
    'DATABASE'     = @('dbeaver')
    'CONNECTORS'   = @()
}

foreach ($section in $sections.Keys) {
    Write-Host ''
    Write-Host $section
    foreach ($key in $sections[$section]) {
        $row = Get-LocalRow $local[$key]
        Write-Row @row
        if ($key -eq 'gh' -and $local['gh'].available) {
            if ($local['gh'].authenticated) { Write-Row 'PASS' 'GitHub CLI auth' 'signed in' }
            else { Write-Row 'WARN' 'GitHub CLI auth' 'not signed in (run gh auth login yourself if needed)' }
        }
        if ($key -eq 'godot') {
            $g = $local['godot']
            if ($g.headless_verified -eq $true) { Write-Row 'PASS' 'Godot headless' 'godot --headless --editor --quit' }
            elseif ($null -eq $g.headless_verified) { Write-Row 'SKIP' 'Godot headless' $g.headless_note }
            else { Write-Row 'WARN' 'Godot headless' $g.headless_note }
        }
    }
    foreach ($key in $mcp.Keys) {
        $m = $mcp[$key]
        if ($m.group -ne $section) { continue }
        switch ($m.status) {
            'connected'               { Write-Row 'PASS' $m.label 'connected' }
            'authentication_required' { Write-Row 'WARN' $m.label 'authentication required' }
            'unavailable'             { Write-Row 'WARN' $m.label ("unavailable ({0})" -f ($m.detail -replace '_', ' ')) }
            default                   { Write-Row 'WARN' $m.label ("unknown ({0})" -f $m.detail) }
        }
    }
}

Write-Host ''
Write-Host 'TASK READINESS'
foreach ($key in $capabilities.Keys) {
    $c = $capabilities[$key]
    if ($c.ready) { Write-Row 'READY' $key '' }
    else { Write-Row 'NO' $key ("missing: {0}" -f ($c.missing -join ', ')) }
}

Write-Host ''
Write-Host 'SUMMARY'
Write-Host ("Required capabilities available: {0}/{1}" -f $summary.required_available, $summary.required_total)
Write-Host ("Optional capabilities available: {0}/{1}" -f $summary.optional_available, $summary.optional_total)
Write-Host ("Blocking issues: {0}" -f $(if ($blocking.Count) { $blocking -join '; ' } else { 'none' }))
if (-not $mcpListing.ran) { Write-Host ("MCP listing: {0}" -f $mcpListing.note) }

$state = [ordered]@{
    schema_version = 1
    generated_at   = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    generated_by   = 'scripts/test-jmw-environment.ps1'
    host           = [ordered]@{
        os         = if ($IsWindows) { 'Windows' } elseif ($IsMacOS) { 'macOS' } elseif ($IsLinux) { 'Linux' } else { 'unknown' }
        powershell = $PSVersionTable.PSVersion.ToString()
    }
    local          = $local
    mcp            = $mcp
    mcp_listing    = $mcpListing
    capabilities   = $capabilities
    summary        = $summary
}

if (-not $NoWrite) {
    $dir = Split-Path -Parent $OutputPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
    Write-Host ("State written to {0}" -f (Resolve-Path -LiteralPath $OutputPath -Relative -ErrorAction SilentlyContinue))
}

if ($blocking.Count) { exit 1 } else { exit 0 }
