# JMW Capabilities

Before any JMW agent claims it can test, build, inspect, record, or automate something, the required local tools and MCP connectors must actually be available. `scripts/test-jmw-environment.ps1` checks that and records the result in `config/capabilities.json`. `scripts/get-jmw-capability.ps1` reads that file and says whether it can still be trusted.

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

## Where capability state lives, and how it stays fresh

There is exactly one copy of capability state per workstation:

| Where | What it is |
|---|---|
| `config/capabilities.json` (master repo) | This workstation's state, written by the checker. **Gitignored, never committed**, so a clone on another machine or in a cloud session never inherits someone else's results. |
| `config/capabilities.example.json` (master repo) | Committed schema example with `generated_at: null`. Never read as real state. |
| `.jmw/local/jmw-master.json` (installed project) | Written by the installer on every sync. A pointer to the master repo's state file, checker and reader. `.jmw/local/` ignores itself in git. **No capability state is copied into projects.** |

**Freshness rule** (implemented once, in `scripts/get-jmw-capability.ps1`): the state is usable only if the file exists, `schema_version` is 1, `generated_at` is set and no more than **24 hours** old, and `host.os` matches the machine reading it. Otherwise it is `MISSING` or `STALE` and nothing may be routed on it.

24 hours is deliberately short: MCP connections and sign-ins can lapse between days, and a rerun takes about a minute.

**Reading it:**

```powershell
# in the master repo
pwsh -NoProfile -File scripts/get-jmw-capability.ps1 -Capability browser_qa
# in an installed project (path comes from .jmw/local/jmw-master.json -> reader_path)
pwsh -NoProfile -File <reader_path> -ProjectPath . -Capability browser_qa
```

| Exit | Output starts with | Meaning |
|---|---|---|
| 0 | `READY` / `FRESH` | Fresh state; the capability is ready (or no capability was asked for). |
| 1 | `NOT READY` | Fresh state; the capability is missing something (named in the output). |
| 2 | `MISSING` / `STALE` / `UNKNOWN` | No usable state, or no such capability. Don't route on it. |

**Refreshing it:** add `-Refresh`. On `MISSING` or `STALE` it reruns the read-only checker, which rewrites the master repo's `config/capabilities.json`, then reads again. Running `scripts/test-jmw-environment.ps1` directly does the same. Re-syncing a project only refreshes the pointer, never the state.

**When the state can't be reached** (no pointer because the project was installed before this change, the master repo isn't on this machine, a cloud session, no `pwsh`): check only the tool the task needs, directly (for example `godot --version`, or whether the MCP tools exist in the current session), and label the result "ad hoc, not from the checker".

## How the Project Manager uses it

See "Capability gate" in `.claude/agents/jmw-project-manager.md`; it is part of step 10 of the PM loop (`orchestration/PM-LOOP.md`), next to the permission check. In short: work out which capability the task needs, read it with the reader (refreshing once if stale), and if a required capability is not ready, say exactly what is missing, don't claim the task was verified, and move on to other eligible work. The capability goes in the TASK ENVELOPE as `required_capabilities`. A ready capability is a precondition, not proof that the task itself was tested.

## Safety

The checker is read only. It never:

- prints or stores secrets, tokens, environment-variable values, MCP commands/URLs/arguments, or install paths;
- reads credential values to prove a connector exists;
- modifies MCP configuration, installs packages, or authenticates anything;
- launches desktop GUI apps.

`gh auth status` output is discarded; only its exit code is used. The Godot headless probe runs inside an empty temporary folder (deleted afterwards) so it can't open or import a real project. Godot may still update its own editor settings in its user-data folder, as any launch does.

`config/capabilities.json` describes one workstation at one moment and is never committed. The repo is public, and a committed copy would be stale truth for every other machine.
