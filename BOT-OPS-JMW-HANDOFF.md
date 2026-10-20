# Bot Ops: the jmw-bot-team side (Phase 1)

Status: **implemented on branch `claude/bot-ops-phase-1-oqndcn`** (based on PR #3). Not merged, not
installed into any project, and nothing has been sent to a real Control Room. The receiving side is
JMW05/byjmw-control-room, `docs/BOT-OPS.md`.

## The contract in one paragraph

Each project's `.jmw/` folder stays the source of truth. A workstation builds a `jmw-report/1`
JSON from it and (only when Jana sets it up and asks) sends it to the Control Room's `bot-ingest`
function. The Control Room validates it strictly, stores a read model, and shows it on a read-only
Bot Ops page. **Nothing ever flows back.** Jana answers gates in a Claude Code session by writing a
decision to `.jmw/DECISIONS.md`; the next report carries that decision, and the database checks it
against the gate.

## What is implemented

| File | What |
|---|---|
| `scripts/jmw-run.mjs` | Run boundaries and the run ledger: `start`, `end`, `task-start`, `task-end`, `step` (heartbeat), `spawn`, `proc-register`, `proc-end`, `proc-cleanup`, `gate-raise`, `gate-consume`, `artifact`, `feedback`, `resume-check`. |
| `scripts/jmw-preflight.mjs` | Required resource preflight before heavy work. |
| `scripts/jmw-report.mjs` | Builds the report (dry run by default); `--send` mode with the rules below; optional periodic send. |
| `scripts/jmw-lib.mjs` | Shared code: vocabularies, key patterns, secret/path checks and packet hash mirrored from the Control Room. |
| `templates/jmw-state/run-policy.json` | Per-project preflight thresholds and timeout budgets. |
| `templates/jmw-state/.gitignore` | Becomes `.jmw/.gitignore`: `local/`, lock files, `.env`, keys, credentials. |
| `scripts/install-jmw-agents.ps1` | Copies the four scripts into `.jmw/scripts/` on every sync; creates `.jmw/runs/`, `.jmw/gates/`, `run-policy.json` and `.jmw/.gitignore` only when missing (an existing `.gitignore` only gets missing lines appended). Never overwrites ledgers, gates, policy or state files. |
| `orchestration/PM-LOOP.md`, `PERMISSIONS.md`, `TASK-CONTRACT.md`, the PM, `game-builder`, `game-qa`, `/jmw-game-build` | Require the run boundaries, the preflight before heavy steps, and the resume rules. |
| `tests/node/*.test.mjs`, `tests/test-bot-ops.ps1`, `tests/test-installer.ps1` | See "Tests". |

All scripts need Node 22 and nothing else. They make no network call except `jmw-report.mjs --send`.
Run them from the project root; in a synced project they are `.jmw/scripts/*.mjs`.

## Using it (what the PM does)

```bash
node .jmw/scripts/jmw-run.mjs start --project-root . --mode GAME_BUILD --target VISUAL_REVIEW
#  -> RUN R-2026-10-20-tales-from-the-crue-01   (RUN-START written, ledger .jmw/runs/<run>.json)
node .jmw/scripts/jmw-run.mjs task-start --project-root . --run R-... --task-key T-2026-10-20-01 \
     --agent game-qa --goal "Verify combat timing" --levels L0 --capabilities game_qa,gameplay_capture
node .jmw/scripts/jmw-run.mjs spawn --project-root . --run R-... --task-key T-2026-10-20-01 \
     --kind godot --label "Godot headless combat lab" -- godot --headless --path . --quit
node .jmw/scripts/jmw-run.mjs task-end --project-root . --run R-... --task-key T-2026-10-20-01 \
     --status done --summary "11 of 12 frames match" --states "GAME_QA -> GAME_QA" --evidence .jmw/artifacts/screenshots/x.png
node .jmw/scripts/jmw-run.mjs end --project-root . --run R-... --status stopped-human-gate --reason "art direction gate open"
node .jmw/scripts/jmw-report.mjs --project-root . --run R-... --out report.json      # dry run
```

(In PowerShell, keep `--` as a separate quoted argument, `'--'`, so it reaches Node.)

**Run keys** `R-YYYY-MM-DD-<project>-NN` (UTC date; `--run-label` gives a shorter middle part).
Every RUN-LOG time is `YYYY-MM-DD HH:MM Z`. A mode caps the run's level (REVIEW/LAUNCH_REVIEW/
FINANCE_REVIEW L0, FIX/OVERNIGHT_SAFE/GAME_BUILD L1, STAGING L2); `--max-level` may only lower it,
except an explicit `L3`, which still needs a consumed gate for each L3 action. L4 is refused.
`task-start` enforces the run's level and task budget (default 25).

**Exit codes** (all scripts): 0 ok, 1 error, 2 usage, 3 preflight refused, 4 crash loop (run ended
blocked), 5 refused by a rule, 124 a spawned program timed out; otherwise `spawn` returns the
program's own exit code.

### Interrupted runs, resume, crash loop
* A RUN-START with no RUN-END is **interrupted**. `start` detects it, writes `resumed_from: <old run>`,
  marks the old ledger `interrupted` (finished_at = its last progress), turns its queued/running
  tasks into `interrupted`, and reconciles its processes (alive and still the same program →
  `orphaned`, `cleanup_required`; gone → `unknown`). These process records are carried into the new
  run's ledger with `run_key` of the old run. `resume-check` shows the same without writing.
* **No blind L2+ retry.** `task-start` numbers attempts across all ledgers. If the previous attempt
  was interrupted and the task is L2 or above, it refuses unless `--prior-attempt-effect
  verified_absent|verified_present` is given. L0/L1 retries get `not_applicable`.
* **Crash loop.** If the last two runs both ended interrupted, `start` writes RUN-START and RUN-END
  `blocked` for the new run, exits 4, and routes nothing.
* `end` never leaves work dangling: tasks without `task-end` become `interrupted`, live processes
  `orphaned`, vanished ones `unknown`, each with a warning.

### Run ledger `.jmw/runs/<run_key>.json`
`{ schema, project, repo {branch, head_commit}, run, tasks, artifacts, processes, gate_consumptions,
framework_feedback, gates: [gate keys] }`, each section exactly in the report's shape (Control Room
`validate.mjs`). Written only by `jmw-run.mjs`, atomically and under a small lock file.
`run.last_progress_at` is updated on every finished task, step, gate and process end (heartbeat).

### Resource preflight (required before heavy work)
Measures free RAM, free disk on the project drive and on the temp drive, and how many heavy programs
(Godot, FFmpeg/ffprobe, ImageMagick, headless browser shells) are already running. Below a minimum it
refuses: exit 3, a plain reason, and with `--run`/`--task-key` the task is recorded `blocked`
(`human_required`) with a small numbers-only evidence file and a RUN-LOG line, so it reaches Bot Ops.
A measurement the OS cannot provide is shown as unknown and never blocks.

| Threshold (`run-policy.json` → `preflight`, or flag) | Default |
|---|---|
| `min_free_ram_mb` (`--min-free-ram-mb`) / warn | 2048 / 4096 |
| `min_free_disk_project_mb` (`--min-free-disk-mb`) / warn | 5120 / 10240 |
| `min_free_disk_temp_mb` (`--min-free-temp-mb`) / warn | 2048 / 5120 |
| `max_heavy_running` (`--max-heavy-running`; `--skip-process-count` to skip) | 2 |

`spawn` runs it automatically for godot, ffmpeg, imagemagick, playwright, browser, browser_recorder
and test_runner (`--heavy` forces it for other kinds).

### Processes and timeout budgets
`spawn` starts the program without a shell, registers pid, start time, kind and the few-word label
(never the command line, arguments, environment or paths; labels with `--`, `=`, slashes, quotes or
`@` are refused), writes its output to `.jmw/artifacts/logs/…log`, and records `exited_ok` /
`exited_error` / `killed` with the exit code. Budgets by kind (minutes, `run-policy.json` →
`timeouts_min`): godot 10, ffmpeg 15, browser_recorder 15, imagemagick 5, playwright 20, browser 20,
test_runner 20, dev_server 60, others 20. At the budget it checks progress first: if the program wrote
output (or `--progress-path` grew, e.g. a capture's frame folder) within the quiet limit
(`stall_min`, 3), it gets more time up to the hard cap (2 × budget); otherwise the process tree is
ended (taskkill /T /F on Windows), the task is recorded `failed` with the reason, and it exits 124.
`proc-cleanup` ends only processes this project registered, and refuses a pid that now belongs to a
different program.

### Human gates `.jmw/gates/<gate_key>.json`
`gate-raise --from packet.json` with `gate_key` (optional, generated), `gate_kind`, `level`,
`question`, `why_now`, `exact_action`, `options[] {key, label, consequence, authorizes}`,
`recommended_option`, `recommended_reason`, `verified_evidence[]`, `not_verified[]`, `risks[]`,
`requested_at` (default now), `expires_at` or `expires_in_days` (default 7, max 30),
`supersedes_gate_key`. Validated like the Control Room; written once (exclusive create) with
`packet_hash` = the Control Room's canonical hash; never edited. **L4** must be `l4_handoff` with only
`done_by_human`, `not_doing`, `deferred`, none authorizing, or it is refused before anything is
written. It prints the three DECISIONS.md lines to copy **only** when Jana states her answer.
`gate-consume` checks: an active decision by a person (not a bot/AI name) for that gate, matching
hash, an option that authorizes, not expired, not already used, not L4, level within the run. Then it
records `gate_consumptions` once.

### Framework feedback
`feedback --slug <slug> --component <agent|skill|orchestration|pm_loop|installer|capability_checker|jmw_report|state_files|process_supervision|other> --severity <critical|high|medium|low> --description "..."`
records `FF-<project>-<slug>` (status open) in the ledger. Fixes happen in jmw-bot-team.

### Sending (`jmw-report.mjs --send`)
* Default is a dry run. Sending needs `--send`.
* URL: `--url` or env `JMW_INGEST_URL`. Must be https (plain http only to 127.0.0.1/localhost for
  tests); no credentials, query or fragment. The real ingest will be
  `https://byjmw-bot-ingest.netlify.app/.netlify/functions/bot-ingest`.
* Secret: **only** env `CONTROL_ROOM_INGEST_SECRET` (≥ 32 characters), sent as
  `X-Control-Room-Ingest-Secret`. A `--secret`/`--token`-style argument is refused. The secret is never
  printed, logged, written to a ledger or report, or included in an error. Creating and storing it is
  Jana's (L4). Set it in the current shell only, e.g. PowerShell `$env:CONTROL_ROOM_INGEST_SECRET = Read-Host -MaskInput`.
* Before sending: body ≤ 1 MiB, no credential-shaped value, and not the secret itself. Redirects are
  not followed. Output is the status code, non-zero counts and warning/error codes only.
* Heartbeat while a run is going: `--send --run R-... --every-min 10` sends every N minutes (1–120)
  until the run has ended (one final send), at most `--max-hours` (default 12).

## Tests

* `npm test` (`node --test "tests/node/*.test.mjs"`): run ledger and resume rules, crash loop,
  processes and orphans, preflight and spawn budgets, gates, send mode against a local mock server
  only, and `control-room-contract.test.mjs`, which imports the Control Room's `validate.mjs`,
  `canonical.mjs`, `jmw-parse.mjs` and `vocab.mjs` from a sibling `byjmw-control-room` checkout (or
  `JMW_CONTROL_ROOM_PATH`) and skips with a message when it is absent.
* `tests/test-bot-ops.ps1`: the same scripts installed into a temp project on Windows.
* `tests/test-installer.ps1`: the new installed files and re-install safety.

## How Jana validates on Windows

From a PowerShell 7 window, with Node 22 and the Control Room repo checked out next to this one:

```powershell
cd C:\path\to\jmw-bot-team; git fetch origin; git checkout claude/bot-ops-phase-1-oqndcn; git pull; npm test; pwsh -NoProfile -File tests/test-foundation.ps1; pwsh -NoProfile -File tests/test-installer.ps1; pwsh -NoProfile -File tests/test-bot-ops.ps1
```

Each prints its pass/fail counts; all should end with `Failed: 0` (or `# fail 0` for `npm test`).

## Not verified yet

* Any of this on Windows/PowerShell (written for it; checked only on Linux, without `pwsh`).
* Free-RAM reading on macOS (Node reports only truly free pages there, so it can under-report).
* A real project (TOT CRUE or any other) and a real Godot/FFmpeg/browser under the watchdog.
* Sending to the real ingest: the secret, reachability and whether sending is manual or scheduled
  are Jana's decisions. Tests only ever talk to a mock server on 127.0.0.1.
