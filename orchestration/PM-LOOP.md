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

**Repeat until a stop condition**

9. Pick the **highest-priority eligible next action**:
   - P0 before P1 before P2 before P3; older before newer;
   - skip issues that are `blocked`, `needs-human`, need credentials, or are outside scope;
   - if no issue is eligible, take the next step the state machine needs to reach the target (for example "run QA").
10. **Check permission** (`PERMISSIONS.md`, `MODES.md`, project policy). If the action's level is above what the mode and policy allow, it is a stop condition for that action. Look for another eligible action before stopping the run.
11. **Route** to the right specialist with a TASK ENVELOPE (`TASK-CONTRACT.md`). Builders build; reviewers review. Do not do a specialist's job yourself.
12. **Receive** the RESULT ENVELOPE. Treat it as a claim, not proof.
13. **Require independent verification** when a builder changed something: send a new TASK ENVELOPE to a different agent (qa-tester, game-qa, design-director, launch-guard) before any issue becomes `verified`.
14. **Capture evidence** in `.jmw/artifacts/` (`ARTIFACTS.md`).
15. **Update issues** in `OPEN-ISSUES.md` (status, evidence, verified_by, verification_status). Create new issues found along the way.
16. **Update `STATUS.md`** (CURRENT block, plain-English summary, verified vs not verified).
17. **Append one line to `RUN-LOG.md`** per step.
18. **Target reached?** If yes, write the owner review packet when the target is a human gate, update `HANDOFF.md`, and stop.
19. **If not reached and another safe action exists, CONTINUE** at step 9.
20. **Stop only for a legitimate stop condition** (below). Before stopping, update STATUS, HANDOFF and RUN-LOG.

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
- Nothing eligible is left (every remaining item is blocked or needs a human).

Not stop conditions: a test failing (fix it in FIX mode, or log it), a minor ambiguity with a safe default (pick it, record it in STATUS), finishing one issue while others remain, wanting reassurance.

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
