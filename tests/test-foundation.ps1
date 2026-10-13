# Automated checks for the combined JMW foundation: PowerShell parsing, agent and skill
# files, the Project Manager's orchestration loop + capability gate, and the capability
# reader's freshness rule. Works only in throwaway temp folders.
# Usage: pwsh -NoProfile -File tests/test-foundation.ps1
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Reader = Join-Path $RepoRoot 'scripts/get-jmw-capability.ps1'
$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("jmw-foundation-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temp | Out-Null
$script:Failures = 0
$script:Passes = 0

function Assert([bool]$Condition, [string]$Name) {
    if ($Condition) { $script:Passes++; Write-Host "PASS  $Name" }
    else { $script:Failures++; Write-Host "FAIL  $Name" }
}
function Get-Frontmatter([string]$Path) {
    $fm = @{}
    $lines = Get-Content $Path
    if ($lines[0] -ne '---') { return $null }
    for ($i = 1; $i -lt $lines.Count -and $lines[$i] -ne '---'; $i++) {
        if ($lines[$i] -match '^([a-z-]+):\s*(.*)$') { $fm[$Matches[1]] = $Matches[2].Trim() }
    }
    return $fm
}
$ThisOs = if ($IsWindows) { 'Windows' } elseif ($IsMacOS) { 'macOS' } elseif ($IsLinux) { 'Linux' } else { 'unknown' }
function New-State([string]$Path, $GeneratedAt, [string]$Os = $ThisOs, [bool]$Ready = $true) {
    [ordered]@{
        schema_version = 1
        generated_at   = $GeneratedAt
        host           = @{ os = $Os; powershell = '7' }
        capabilities   = [ordered]@{
            browser_qa     = [ordered]@{ ready = $Ready; missing = @(if (-not $Ready) { 'mcp:playwright' }) }
            finance_review = [ordered]@{ ready = $true; missing = @() }
        }
    } | ConvertTo-Json -Depth 6 | Set-Content -Path $Path -Encoding utf8
}
function Invoke-Reader([string[]]$ReaderArgs) {
    $out = & pwsh -NoProfile -File $Reader @ReaderArgs 2>&1 | Out-String
    return @{ code = $LASTEXITCODE; out = $out }
}

try {
    # 1. Every PowerShell file parses
    foreach ($f in Get-ChildItem $RepoRoot -Recurse -Filter '*.ps1' -File) {
        $tokens = $null; $errs = $null
        [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errs) | Out-Null
        Assert ($errs.Count -eq 0) ("parses: " + [System.IO.Path]::GetRelativePath($RepoRoot, $f.FullName))
    }

    # 2. Agents: valid frontmatter, and every agent the PM may delegate to exists
    $AgentDir = Join-Path $RepoRoot '.claude/agents'
    $AgentNames = @()
    foreach ($a in Get-ChildItem $AgentDir -Filter '*.md') {
        $fm = Get-Frontmatter $a.FullName
        Assert ($fm -and $fm['name'] -eq $a.BaseName -and $fm['description'] -and $fm['tools']) "agent frontmatter: $($a.BaseName)"
        $AgentNames += $a.BaseName
    }
    $PmPath = Join-Path $AgentDir 'jmw-project-manager.md'
    $PmTools = (Get-Frontmatter $PmPath)['tools']
    Assert ($PmTools -match 'Agent\(([^)]*)\)') 'PM can delegate (Agent tool listed)'
    foreach ($n in ($Matches[1] -split ',\s*')) { Assert ($AgentNames -contains $n) "PM delegate exists: $n" }

    # 3. Skills: discoverable frontmatter, name matches folder, routes to the PM
    foreach ($s in Get-ChildItem (Join-Path $RepoRoot '.claude/skills') -Directory) {
        $sk = Join-Path $s.FullName 'SKILL.md'
        $fm = if (Test-Path $sk) { Get-Frontmatter $sk } else { $null }
        Assert ($fm -and $fm['name'] -eq $s.Name -and $fm['description'].Length -gt 20) "skill frontmatter: $($s.Name)"
        Assert ((Get-Content $sk -Raw) -match 'Project Manager|jmw-project-manager') "skill runs through the PM: $($s.Name)"
    }

    # 4. Project Manager has BOTH the orchestration loop and the capability gate
    $Pm = Get-Content $PmPath -Raw
    $Steps = [regex]::Matches($Pm, '(?m)^(\d+)\. ') | ForEach-Object { [int]$_.Groups[1].Value }
    foreach ($n in 1..20) { Assert ($Steps -contains $n) "PM loop step $n present" }
    Assert ($Pm -match '(?m)^10\. Check action permission .*capabilit') 'PM loop step 10 checks permission AND capability'
    Assert ($Pm -match '(?m)^11\. .*required_capabilities') 'PM loop step 11 passes required_capabilities'
    Assert ($Pm -match '## Execution loop' -and $Pm -match '## Capability gate') 'PM has both sections'
    Assert ($Pm.IndexOf('## Capability gate') -gt $Pm.IndexOf('## Execution loop')) 'capability gate follows the loop it belongs to'
    foreach ($p in 'get-jmw-capability.ps1', '.jmw/local/jmw-master.json', '-Refresh', 'ad hoc, not from the checker', 'precondition, not evidence',
                   'Missing optional tool never blocks|missing optional tool never blocks', 'Never copy capability state into a project') {
        Assert ($Pm -match $p) "PM capability gate mentions: $p"
    }
    foreach ($p in 'Never bypass a human approval gate', 'Do not deploy production, change DNS, release payment, post accounting entries',
                   'never perform an L4 action', 'You never verify your own or a builder', 'Stop only for', 'PM-LOOP.md', 'STATUS.md') {
        Assert ($Pm -match [regex]::Escape($p) -or $Pm -match $p) "PM keeps: $p"
    }

    # 5. Orchestration files and master CLAUDE.md carry the capability rule; safety rules intact
    $Loop = Get-Content (Join-Path $RepoRoot 'orchestration/PM-LOOP.md') -Raw
    Assert ($Loop -match '10\. \*\*Check permission and capability') 'PM-LOOP step 10 includes capability'
    Assert ((Get-Content (Join-Path $RepoRoot 'orchestration/TASK-CONTRACT.md') -Raw) -match 'required_capabilities') 'TASK ENVELOPE has required_capabilities'
    $Master = Get-Content (Join-Path $RepoRoot 'CLAUDE.md') -Raw
    Assert ($Master -match '## Orchestration' -and $Master -match '## Capability checks') 'CLAUDE.md has orchestration and capability sections'
    foreach ($p in 'deploy to production unless', 'alter production DNS', 'release or schedule a payment', 'post a journal entry', 'treat AI review as human approval', 'expose secrets') {
        Assert ($Master -match [regex]::Escape($p)) "CLAUDE.md safety rule kept: $p"
    }
    $Perm = Get-Content (Join-Path $RepoRoot 'orchestration/PERMISSIONS.md') -Raw
    foreach ($p in 'Payments', 'DNS change', 'destructive database', 'secret creation', 'creating paid resources') { Assert ($Perm -match $p) "L4 still lists: $p" }

    # 6. Capability state is local-only; docs cover every capability; no workstation versions baked in
    Push-Location $RepoRoot
    try { & git check-ignore -q config/capabilities.json; Assert ($LASTEXITCODE -eq 0) 'config/capabilities.json is gitignored' } finally { Pop-Location }
    $Example = Get-Content (Join-Path $RepoRoot 'config/capabilities.example.json') -Raw | ConvertFrom-Json
    Assert ($Example.schema_version -eq 1 -and $null -eq $Example.generated_at) 'example state is schema-only (generated_at null)'
    $Doc = Get-Content (Join-Path $RepoRoot 'docs/CAPABILITIES.md') -Raw
    $CheckerSrc = Get-Content (Join-Path $RepoRoot 'scripts/test-jmw-environment.ps1') -Raw
    foreach ($m in [regex]::Matches($CheckerSrc, '(?m)^\s{4}([a-z_]+)\s+= @\{ description')) {
        Assert ($Doc -match [regex]::Escape($m.Groups[1].Value)) "docs/CAPABILITIES.md documents $($m.Groups[1].Value)"
    }
    foreach ($f in 'docs/CAPABILITIES.md', 'config/capabilities.example.json', 'scripts/test-jmw-environment.ps1', '.claude/agents/jmw-project-manager.md', 'CLAUDE.md') {
        Assert (-not ((Get-Content (Join-Path $RepoRoot $f) -Raw) -match '7\.6\.6|4\.7\.2')) "no validated workstation version hardcoded in $f"
    }

    # 7. Capability reader: freshness rule
    $Now = '2026-10-13T12:00:00Z'
    $S = Join-Path $Temp 'state.json'
    New-State $S '2026-10-13T06:00:00Z'
    $r = Invoke-Reader @('-StatePath', $S, '-Capability', 'browser_qa', '-Now', $Now)
    Assert ($r.code -eq 0 -and $r.out -match '^READY') 'fresh + ready -> exit 0 READY'
    $r = Invoke-Reader @('-StatePath', $S, '-Now', $Now)
    Assert ($r.code -eq 0 -and $r.out -match '^FRESH') 'fresh, no capability asked -> exit 0 FRESH'
    New-State $S '2026-10-13T06:00:00Z' -Ready $false
    $r = Invoke-Reader @('-StatePath', $S, '-Capability', 'browser_qa', '-Now', $Now)
    Assert ($r.code -eq 1 -and $r.out -match 'NOT READY.*mcp:playwright') 'fresh + not ready -> exit 1 naming what is missing'
    New-State $S '2026-10-11T06:00:00Z'
    $r = Invoke-Reader @('-StatePath', $S, '-Capability', 'browser_qa', '-Now', $Now)
    Assert ($r.code -eq 2 -and $r.out -match '^STALE') 'older than 24h -> exit 2 STALE'
    $r = Invoke-Reader @('-StatePath', $S, '-Capability', 'browser_qa', '-Now', $Now, '-MaxAgeHours', '72')
    Assert ($r.code -eq 0) '-MaxAgeHours widens the window'
    New-State $S '2026-10-13T06:00:00Z' -Os 'SomeOtherOS'
    $r = Invoke-Reader @('-StatePath', $S, '-Capability', 'browser_qa', '-Now', $Now)
    Assert ($r.code -eq 2 -and $r.out -match 'generated on SomeOtherOS') 'state from another OS -> exit 2'
    New-State $S $null
    $r = Invoke-Reader @('-StatePath', $S, '-Now', $Now)
    Assert ($r.code -eq 2 -and $r.out -match 'baseline only') 'generated_at null -> exit 2'
    $r = Invoke-Reader @('-StatePath', (Join-Path $RepoRoot 'config/capabilities.example.json'), '-Now', $Now)
    Assert ($r.code -eq 2) 'committed example is never treated as real state'
    $r = Invoke-Reader @('-StatePath', (Join-Path $Temp 'nope.json'), '-Now', $Now)
    Assert ($r.code -eq 2 -and $r.out -match '^MISSING') 'missing file -> exit 2 MISSING'
    New-State $S '2026-10-13T06:00:00Z'
    $r = Invoke-Reader @('-StatePath', $S, '-Capability', 'teleport', '-Now', $Now)
    Assert ($r.code -eq 2 -and $r.out -match '^UNKNOWN') 'unknown capability -> exit 2 UNKNOWN'

    # 8. Installed project: pointer resolution and -Refresh (with a stand-in checker)
    $Proj = Join-Path $Temp 'project'
    New-Item -ItemType Directory -Force -Path (Join-Path $Proj '.jmw/local') | Out-Null
    $Fake = Join-Path $Temp 'fake-checker.ps1'
    $FreshStamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    Set-Content $Fake @"
param([string]`$OutputPath)
[ordered]@{ schema_version = 1; generated_at = '$FreshStamp'; host = @{ os = '$ThisOs' }; capabilities = @{ browser_qa = @{ ready = `$true; missing = @() } } } | ConvertTo-Json -Depth 5 | Set-Content -Path `$OutputPath
"@
    $Linked = Join-Path $Temp 'master-state.json'
    @{ capabilities_path = $Linked; checker_path = $Fake } | ConvertTo-Json | Set-Content (Join-Path $Proj '.jmw/local/jmw-master.json')
    New-State $Linked '2026-10-13T06:00:00Z'
    $r = Invoke-Reader @('-ProjectPath', $Proj, '-Capability', 'browser_qa', '-Now', $Now)
    Assert ($r.code -eq 0) 'project reads master state through .jmw/local/jmw-master.json'
    New-State $Linked '2020-01-01T00:00:00Z'
    $r = Invoke-Reader @('-ProjectPath', $Proj, '-Capability', 'browser_qa')
    Assert ($r.code -eq 2) 'project sees stale master state as stale'
    $r = Invoke-Reader @('-ProjectPath', $Proj, '-Capability', 'browser_qa', '-Refresh')
    Assert ($r.code -eq 0 -and $r.out -match 'Refreshing' -and $r.out -match 'READY') '-Refresh reruns the checker and re-reads'
    Assert (-not (Test-Path (Join-Path $Proj '.jmw/capabilities.json'))) 'refresh writes master state, not a project copy'
}
finally {
    Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Passed: $script:Passes  Failed: $script:Failures"
if ($script:Failures -gt 0) { exit 1 }
exit 0
