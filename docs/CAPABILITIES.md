# JMW Capabilities

Before any JMW agent claims it can test, build, inspect, record, or automate something, the required local tools and MCP connectors must actually be available. `scripts/test-jmw-environment.ps1` checks that and records the result in `config/capabilities.json`.

## Run it

From the `jmw-bot-team` repo, in PowerShell 7:

```powershell
pwsh -NoProfile -File scripts/test-jmw-environment.ps1
```

Options:

| Option | Effect |
|---|---|
| `-NoWrite` | Print the summary only; don't update `config/capabilities.json`. |
| `-OutputPath <file>` | Write the JSON somewhere else. |
| `-SkipMcp` | Don't run `claude mcp list` (MCP states become `unknown`). |
| `-SkipGodotHeadless` | Don't run the Godot headless launch probe. |
| `-GodotPath <exe>` | Use this Godot executable if `godot` isn't on PATH. |

Exit code is `0` when every required (CORE) tool is available and `1` otherwise.

## What it checks

| Group | Items | Required |
|---|---|---|
| CORE | `pwsh`, `claude`, `git`, `gh` (+ whether `gh` is signed in), `node`, `npm`, `python` (or `py`), `py` | yes (`py` optional) |
| MEDIA | `ffmpeg`, `magick`, Krita, Audacity | no |
| UTILITY | `rg`, `jq` | no |
| GAME | `godot` version, and `godot --headless --editor --quit` | no |
| DATABASE | DBeaver | no |
| QA / BROWSER (MCP) | Playwright, Chrome DevTools | no globally; required for browser QA tasks |
| CONNECTORS (MCP) | Supabase, Netlify, Vercel, QuickBooks, Gmail, Google Drive, Google Calendar | no |

Versions are detected on every run. Nothing is hardcoded.

Desktop apps (Krita, Audacity, DBeaver) are found without launching them: PATH, then the Windows uninstall registry, then common install folders. Not finding one is a warning, never a failure.

## MCP states

MCP status comes from `claude mcp list`. Only the server name and a normalized status are kept; the command, URL, and arguments are discarded.

| State | Meaning |
|---|---|
| `connected` | Claude Code reports the server connected. |
| `authentication_required` | Listed but needs sign-in. A human must authenticate it. |
| `unavailable` | Failed to connect, timed out, not configured, or not listed at all (`detail` says which). |
| `unknown` | The listing was skipped or failed, or the status text wasn't recognized. |

When several servers match one capability (for example two Gmail plugins), the best state wins and all matches are listed under `matched_servers`.

`claude mcp list` health-checks each server, which starts local stdio MCP servers briefly. It does not change MCP configuration. Connectors that exist only in the Claude desktop/web app and not in Claude Code show as `unavailable (not_listed)` here.

## Task capability map

The checker also computes `capabilities` in the JSON, which is what the Project Manager routes on.

| Capability | Requires |
|---|---|
| `github_operations` | git, gh, gh signed in |
| `website_build` | git, node, npm |
| `browser_qa` | Playwright MCP connected |
| `deep_browser_debugging` | Chrome DevTools MCP connected |
| `game_qa` | Godot, Godot headless verified |
| `gameplay_capture` | Godot, FFmpeg |
| `image_cleanup` | ImageMagick |
| `media_processing` | FFmpeg |
| `python_scripting` | Python |
| `finance_review` | nothing local (reviews supplied files) |
| `quickbooks_data` | QuickBooks MCP connected |
| `supabase_ops` / `netlify_ops` / `vercel_ops` | the matching MCP connected |

Website review doesn't depend on Audacity, Krita, or Godot; finance review doesn't depend on Godot. Missing optional tools never block unrelated work.

## How the Project Manager uses it

See "Capability check before routing" in `.claude/agents/jmw-project-manager.md`. In short: work out which capability the task needs, read `config/capabilities.json`, rerun the checker if the state is missing, stale (older than 7 days), or not ready, and if a required capability is missing, say exactly what is missing and don't claim the task was verified. A ready capability is a precondition, not proof that the task itself was tested.

## Safety

The checker is read only. It never:

- prints or stores secrets, tokens, environment-variable values, MCP commands/URLs/arguments, or install paths;
- reads credential values to prove a connector exists;
- modifies MCP configuration, installs packages, or authenticates anything;
- launches desktop GUI apps.

`gh auth status` output is discarded; only its exit code is used. The Godot headless probe runs inside an empty temporary folder (deleted afterwards) so it can't open or import a real project. Godot may still update its own editor settings in its user-data folder, as any launch does.

`config/capabilities.json` describes one workstation at one moment. It's committed so agents can read it, so rerun the checker on the machine doing the work rather than trusting a copy from another machine.
