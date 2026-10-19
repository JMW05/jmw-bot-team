# Bot Ops handoff: what jmw-bot-team must do for the Control Room

Status: **proposal on branch `claude/bot-ops-phase-1-oqndcn`** (based on PR #3). Nothing here is
merged, installed into a project, or sending anything. The Control Room side is
JMW05/byjmw-control-room, same branch name, `docs/BOT-OPS.md`.

## The contract in one paragraph

Each project's `.jmw/` folder stays the source of truth. A workstation builds a `jmw-report/1`
JSON from it and sends it to the Control Room's `bot-ingest` function. The Control Room validates
it strictly, stores a read model, and shows it on a read-only Bot Ops page. **Nothing ever flows
back.** Jana answers gates in a Claude Code session by writing a decision to `.jmw/DECISIONS.md`;
the next report carries that decision, and the database checks it against the gate.

## What is on this branch

| File | What |
|---|---|
| `scripts/jmw-report.mjs` | Builds a report from a project's `.jmw/` (state files, run ledger, gate packets, capability state). **Dry run only**: prints or writes JSON, never sends, reads no credentials. Packet hashes use the same canonical form as the Control Room. |
| `templates/jmw-state/RUN-LOG.md` | Adds RUN-START / RUN-END lines, the `interrupted` result, and the timezone rule. |
| `templates/jmw-state/DECISIONS.md` | Adds the three gate-answer lines. |
| this file | Everything else, as a work list. |

Checked (observed): a report built by `jmw-report.mjs` from the Control Room's TEST fixture
(TOT CRUE run 2) passes the Control Room validator, and its four gate hashes equal the hashes the
Control Room computes. The templates parse cleanly with the Control Room parsers.

Not checked: the script on Windows/PowerShell, the installer copying it, and any real project.

## Work list for the framework

### 1. Run boundaries (PM-LOOP)
* At orient: write `RUN-START` to RUN-LOG with a new run key `R-YYYY-MM-DD-<project>-NN`, mode,
  workflow, `STATE -> TARGET`, and `resumed_from:` the previous run if that run has a RUN-START but
  no RUN-END.
* At every stop: write `RUN-END` with the status (`succeeded`, `stopped-human-gate`,
  `stopped-no-eligible-work`, `blocked`, `budget-exhausted`, `failed`, `cancelled`), the end state
  and the reason. A run that dies writes nothing; the next run detects that.
* Every time: include a timezone (`Z`).

### 2. Interrupted runs and recovery
* A run with RUN-START and no RUN-END is **interrupted**. Its unfinished tasks are `interrupted`,
  not done and not failed: their effects are unknown.
* Resuming: re-read state, then for each interrupted task:
  * L0/L1: may simply be re-run.
  * **L2+: never retried blind.** First verify whether the earlier attempt's effect happened
    (branch pushed? file written? PR opened?) and record `prior_attempt_effect: verified_absent`
    or `verified_present` on the new attempt. The Control Room refuses an L2+ retry without it.
* **Crash loop:** if the last two runs both ended interrupted, the third must not retry the same
  work: write RUN-END `blocked` with the reason and stop. (The Control Room flags two in a row.)

### 3. Run ledger (`.jmw/runs/<run_key>.json`, new, gitignored or committed per project policy)
Written by the PM as the run goes, in exactly the shape of the report's `run`, `tasks`,
`artifacts`, `processes`, `gate_consumptions`, `framework_feedback` and `gates` (a list of gate
keys), plus `repo {branch, head_commit}`. See `jmw-report.mjs` header and the Control Room's
`validate.mjs` for fields. `run.last_progress_at` updates whenever a step finishes; the
Control Room sets the heartbeat itself at receipt.

### 4. Human gates (`.jmw/gates/<gate_key>.json`, new)
* One file per gate with: `gate_key`, `gate_kind` (state_gate, l3_approval, l4_handoff,
  credentials_needed, policy_decision, material_ambiguity, visual_review, financial_review),
  `level`, `question`, `why_now`, `exact_action`, `options[] {key, label, consequence, authorizes}`,
  `recommended_option`, `recommended_reason`, `verified_evidence[]`, `not_verified[]`, `risks[]`,
  `requested_at`, `expires_at` (≤ 30 days).
* Never edit a gate after it is raised. A changed question is a new gate with
  `supersedes_gate_key`.
* **L4** gates are `l4_handoff`, options only `done_by_human`, `not_doing`, `deferred`, none
  `authorizes`. No bot ever acts on one.
* Before acting on an approval (L3, or any option that `authorizes`): the decision must name the
  gate, the answer and the packet hash; the gate must not be expired; and the run records a
  `gate_consumptions` entry. It is used once. This fits the existing rule that L3 needs approval
  in the current task: the decision is that approval, for that packet only.
* Agents never write the gate lines in DECISIONS.md on their own. They copy them only when Jana
  states the answer in the session, with her name as `decided_by`.

### 5. Process registration and cleanup
* Register every long-lived process a task starts (Godot, FFmpeg, ImageMagick, Playwright/browser,
  dev server, test runner) in the ledger: pid, start time, kind, a few-word label (**never** the
  command line, arguments, environment or paths), ports.
* On task end: record `exited_ok` / `exited_error` / `killed` with exit code.
* On resume: check the previous run's processes. Still alive with no owner → `orphaned`,
  `cleanup_required: true`. Cleaning up is a local action of the same level as the task that
  started it; the Control Room never kills anything.

### 6. Resource guard and timeouts
* Per task: a wall-clock timeout by kind (suggested: Godot headless 10 min, capture 15 min, tests
  20 min). A timeout is `failed` with the reason, not a hang.
* Watchdogs must check output progress before killing (TOT CRUE feedback: a capture still writing
  frames was aborted).
* One heavy process kind at a time per workstation unless the profile allows more.

### 7. Framework feedback
When a run notices a problem in jmw-bot-team itself (an agent rule, PM loop step, installer,
capability checker), add a `framework_feedback` entry: key `FF-<project>-<slug>`, component,
reference, severity, description. Fixes happen here, never from the Control Room.

### 8. Sending (not built; human-gated)
`jmw-report.mjs` has no send mode on purpose. Sending needs three decisions only Jana can make:
the ingest reachability route (Netlify team-login blocks scripts today), the ingest secret
(L4: created and stored by Jana; never in a repo, a `.jmw` file or a log), and whether sending is
manual or scheduled (Phase 1: manual only).

## Acceptance tests to add here
1. `jmw-report.mjs` on the templates produces a report the Control Room validator accepts.
2. Gate hash parity with the Control Room for a fixed packet (golden hash).
3. RUN-LOG with RUN-START and no RUN-END → next run writes `resumed_from`.
4. An L2 task interrupted → the next attempt carries `prior_attempt_effect`.
5. Two interrupted runs → the third writes RUN-END `blocked`.
6. Process labels never contain `--`, `=`, `/`, `\` or quotes.
7. No report ever contains `.env` content, tokens or absolute paths (run the Control Room's
   `looksSecret` check over the output).
8. An L4 gate file with an `authorizes: true` option is refused by the PM before it is written.
