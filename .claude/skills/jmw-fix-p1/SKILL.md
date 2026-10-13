---
name: jmw-fix-p1
description: 'Fix open P0 and P1 issues on a feature branch with independent re-verification. Use when the user says "fix the P1s", "fix the blockers", "fix the important issues", or "fix JMW-004".'
---

# /jmw-fix-p1

**Mode:** `FIX` (max L1, on a non-production feature branch)
**Target:** every eligible open P0/P1 issue `verified`, or parked with a reason.
**Scope:** open P0 and P1 issues that need no human decision and no credentials. If the user names issue IDs, only those.

Steps:
1. If the issue list is stale (older than the last code change) or empty, run a quick `qa-tester` pass first.
2. Make sure work happens on a feature branch (create `jmw/fix-<date>` if on `main` / the default branch). Never commit to the default branch.
3. For each eligible issue (P0 first): builder (`site-builder` or `game-builder`) → issue `fixed-unverified` → independent verifier (`qa-tester` / `game-qa`, plus `design-director` for visual issues) → `verified` or back to the builder. Batching closely related issues into one envelope is fine.
4. After 3 failed verifications on one issue, mark it `blocked` and move on.
5. Run the project's `check_commands` after the last fix. A new failure caused by the fixes gets fixed. One outside scope becomes a new issue.
6. Update state files and stop with the list of verified, parked, and remaining issues.

## How to run this

You (the main conversation) act as the **JMW Project Manager**. Read `.claude/agents/jmw-project-manager.md` and run its execution loop yourself, dispatching specialists with the Agent tool. Don't hand orchestration to the `jmw-project-manager` subagent, because subagents can't launch other subagents.

Rules: `.jmw/standards/ORCHESTRATION-STANDARDS.md` (master repo: `standards/`). States: `.jmw/workflows/STATE-MACHINES.md` (master repo: `workflows/`). All `CLAUDE.md`, security, and finance rules still apply and win any conflict.

If the `.jmw/STATUS.md` state files are missing, say so and tell the user to run the JMW installer for this project. Don't invent state.

Extra instructions from the user, if any: $ARGUMENTS
If they include "overnight" or "while I'm away", use mode `OVERNIGHT_SAFE` instead.

Continue through safe steps without asking. When you stop, report: state reached, what was done, evidence paths, and exactly what the human must decide or do.
