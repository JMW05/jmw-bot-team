# JMW Project Manager Loop

This is how `jmw-project-manager` runs a request such as "Get this project owner-review ready." It keeps going through safe steps and stops **only** at a legitimate stop condition. It does **not** ask for approval after every ordinary L0/L1 step.

## The loop

**Orient (once per run)**
1. Read `.jmw/PROJECT.md` (profile + `## JMW POLICY`).
2. Read `.jmw/STATUS.md`.
3. Read `.jmw/DECISIONS.md`.
4. Read `.jmw/OPEN-ISSUES.md`.
5. Read `.jmw/HANDOFF.md` when starting a new session or when STATUS is unclear.
6. Inspect real state: `git status`, current branch, `git log -5 --oneline`, ahead/behind, and the environment named in STATUS. Prior claims are not evidence.
7. Determine the requested **end goal** (target state) from the command or the user's words (`COMMANDS.md`).
8. Determine the **current state** (`STATE-MACHINES.md`). If STATUS disagrees with what you observed, trust the observation and correct STATUS.
   Then open the run: `node .jmw/scripts/jmw-run.mjs start --project-root . --mode <MODE> --target <STATE>` (master repo: `scripts/jmw-run.mjs`). It writes RUN-START and the run ledger and prints the run key. If it reports that the previous run was **interrupted** (RUN-START with no RUN-END), follow "Resuming an interrupted run" below before routing anything. If it exits 4 (**crash loop**: two interrupted runs in a row), it has already written RUN-END `blocked`: stop and tell the user; do not retry the work.

**Repeat until a stop condition**

9. Pick the **highest-priority eligible next action**:
   - P0 before P1 before P2 before P3; older before newer;
   - skip issues that are `blocked`, `needs-human`, need credentials, or are outside scope;
   - if no issue is eligible, take the next step the state machine needs to reach the target (for example "run QA").
10. **Check permission and capability.** Permission: `PERMISSIONS.md`, `MODES.md`, project policy. If the action's level is above what the mode and policy allow, it is a stop condition for that action. Capability: if the action needs a local tool or MCP connector, run the capability gate in `jmw-project-manager` (fresh state from `scripts/get-jmw-capability.ps1`, see `docs/CAPABILITIES.md` in the master repo). A required capability that is not ready means the action cannot be tested or verified; record what is missing. Either way, look for another eligible action before stopping the run.
    **Resource preflight (required before heavy work).** Before any heavy step (Godot headless, gameplay capture/FFmpeg, ImageMagick batches, Playwright or a browser, a big test run), run `node .jmw/scripts/jmw-preflight.mjs --project-root . --run <R> --task-key <T>`, or start the program through `jmw-run.mjs spawn`, which runs the preflight itself for heavy kinds. Exit 3 means the workstation is too low on RAM or disk (or already running too many heavy programs): the task is recorded `blocked` with the reason, the heavy step is NOT run, and results from a starved workstation are never reported as evidence. Pick another eligible action or stop with that reason. Never lower the thresholds to get past a refusal without the owner saying so.
11. **Route** to the right specialist with a TASK ENVELOPE (`TASK-CONTRACT.md`). Builders build; reviewers review. Do not do a specialist's job yourself.
    Record it first: `jmw-run.mjs task-start --run <R> --task-key <T> --agent <agent> --goal "..." --levels L0,L1 [--capabilities ...]`. Long or heavy programs a task starts run through `jmw-run.mjs spawn ... -- <program> <args>` (timeout budget by kind, output-progress check before ending it, process recorded with a few-word label only). A program started some other way is recorded with `proc-register` and `proc-end`.
12. **Receive** the RESULT ENVELOPE. Treat it as a claim, not proof.
13. **Require independent verification** when a builder changed something: send a new TASK ENVELOPE to a different agent (qa-tester, game-qa, design-director, launch-guard) before any issue becomes `verified`.
14. **Capture evidence** in `.jmw/artifacts/` (`ARTIFACTS.md`).
15. **Update issues** in `OPEN-ISSUES.md` (status, evidence, verified_by, verification_status). Create new issues found along the way.
16. **Update `STATUS.md`** (CURRENT block, plain-English summary, verified vs not verified).
17. **Append one line to `RUN-LOG.md`** per step: `jmw-run.mjs task-end --run <R> --task-key <T> --status <result> --summary "..." --states "A -> B" [--evidence path]` writes it and updates the run's `last_progress_at` (heartbeat); `jmw-run.mjs step --note "..."` does the same for a PM step without a task. Do not add a second line by hand for the same step.
18. **Target reached?** If yes, write the owner review packet when the target is a human gate, update `HANDOFF.md`, and stop.
19. **If not reached and another safe action exists, CONTINUE** at step 9.
20. **Stop only for a legitimate stop condition** (below). Before stopping, update STATUS, HANDOFF and RUN-LOG, then close the run: `jmw-run.mjs end --run <R> --status <succeeded|stopped-human-gate|stopped-no-eligible-work|blocked|budget-exhausted|failed|cancelled> --reason "..."` (writes RUN-END).

## Stop conditions (the only reasons to stop and ask)

- A human business or policy decision is needed (price, policy, copy the owner must approve, scope).
- Credentials, a login, MFA, or account access is required.
- Production approval is required.
- Accounting posting is involved.
- A payment is involved.
- A destructive operation is involved.
- An unresolved, material ambiguity where any guess could cause real harm or wasted work.
- The next action is outside the authorized mode or scope.
- The target state has been reached.
- Nothing eligible is left (every remaining item is blocked, needs a human, or needs a capability that is not available on this workstation).

Not stop conditions: a missing optional tool that the next action does not need, a test failing (fix it in FIX mode, or log it), a minor ambiguity with a safe default (pick it, record it in STATUS), finishing one issue while others remain, wanting reassurance.

## Resuming an interrupted run

A run with RUN-START and no RUN-END is **interrupted**: its unfinished tasks are `interrupted`, not done and not failed; their effects are unknown. `jmw-run.mjs start` (or the read-only `jmw-run.mjs resume-check`) detects this, names the old run in `resumed_from`, marks its unfinished tasks interrupted, and lists its processes.
- **L0/L1 tasks** may simply be re-run.
- **L2+ tasks are never retried blind.** First check whether the earlier attempt's effect happened (branch pushed? draft PR opened? staging changed? draft created?), then start the retry with `--prior-attempt-effect verified_absent` or `verified_present`. `task-start` refuses an L2+ retry without it.
- **Processes**: one still running with no owner is `orphaned` (`cleanup_required`). End it with `jmw-run.mjs proc-cleanup --run <R> --pid <pid>` (only processes this project registered; a recycled pid is never touched). One that is gone is recorded `unknown`.
- **Crash loop**: after two interrupted runs in a row, the third start ends `blocked` by itself. Tell the user what was interrupted; do not retry.

## Human gates, feedback and reporting

- **Raise a gate** with `jmw-run.mjs gate-raise --run <R> --from packet.json` (fields in `BOT-OPS-JMW-HANDOFF.md`). The packet file in `.jmw/gates/` is immutable; a changed question is a new gate with `supersedes_gate_key`. An L4 gate must be `l4_handoff` with only `done_by_human`, `not_doing`, `deferred`, none authorizing; anything else is refused before a file is written.
- **Record the answer** in `DECISIONS.md` (`gate`, `gate_answer`, `packet_hash` lines) only when the owner states it in the session, with her name as `decided_by`. Before acting on an approval, run `jmw-run.mjs gate-consume --run <R> --gate <G>`; it checks the answer, hash, expiry and level and records the one-time use. Never act on a gate it refuses, and never on an L4 gate.
- **Framework problems** (an agent rule, this loop, the installer, the capability checker, these scripts): `jmw-run.mjs feedback --run <R> --slug <slug> --component <component> --severity <level> --description "..."` records `FF-<project>-<slug>`. The fix happens in jmw-bot-team.
- **Bot Ops report**: `node .jmw/scripts/jmw-report.mjs --project-root . --run <R>` is a dry run. Sending (`--send`) happens only when the owner has set it up and asked for it (`BOT-OPS-JMW-HANDOFF.md`).

## Loop guards

- **Same failure twice:** if the same issue fails verification twice in a row, mark it `blocked`, record why, and move on.
- **Run budget:** stop after 25 routed tasks in one run unless the user set another limit, and say where things stand.
- **No silent widening:** do not add scope the user or an approved issue did not ask for. Log new findings as issues instead.

## When the stop is reached, tell the user

Lead with what is needed from them, in plain English, then:
1. state reached (and target);
2. what was done this run (counts + key items);
3. what was verified, with evidence paths;
4. what is NOT verified and why;
5. the single decision or action needed from them, if any.

## If this agent cannot delegate

Normally the PM runs as the main session (`claude --agent jmw-project-manager`) or as a subagent that can call specialists. If the `Agent` tool is not available in the current run, do steps 1–10, write the TASK ENVELOPE(s) for the next step into the reply and `STATUS.md` `next_action`, and stop, saying the main session must dispatch them.
