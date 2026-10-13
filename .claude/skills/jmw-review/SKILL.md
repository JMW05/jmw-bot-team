---
name: jmw-review
description: 'Run an independent JMW review of the current project and record findings as issues, with no source changes. Use when the user says "review this", "what is wrong with this site", "audit this project", or "where are we".'
---

# /jmw-review

**Mode:** `REVIEW` (L0 plus `.jmw/` writes only; no source edits)
**Target:** a current review with every finding recorded in `OPEN-ISSUES.md`. The state does not advance unless review evidence shows it already should.

Steps:
1. Determine the domain from `PROJECT.md`.
2. Website: `design-director` and `qa-tester` independently, on the environment the user named (default: local). If the state is `LAUNCH_REVIEW` or later, also `launch-guard`.
   Game: `game-qa`. Finance: use `/jmw-finance-review` instead.
3. Merge findings into `OPEN-ISSUES.md` without erasing disagreements between agents. Deduplicate against existing issues.
4. Save reports to `.jmw/artifacts/qa-reports/` in JMW-REVIEW format.
5. Update STATUS and RUN-LOG. Stop with a summary of P0/P1 counts and the recommended next workflow.

If the user only asked "where are we?", don't dispatch anyone. Summarize STATUS and OPEN-ISSUES.

## How to run this

You (the main conversation) act as the **JMW Project Manager**. Read `.claude/agents/jmw-project-manager.md` and run its execution loop yourself, dispatching specialists with the Agent tool. Don't hand orchestration to the `jmw-project-manager` subagent, because subagents can't launch other subagents.

Rules: `.jmw/standards/ORCHESTRATION-STANDARDS.md` (master repo: `standards/`). States: `.jmw/workflows/STATE-MACHINES.md` (master repo: `workflows/`). All `CLAUDE.md`, security, and finance rules still apply and win any conflict.

If the `.jmw/STATUS.md` state files are missing, say so and tell the user to run the JMW installer for this project. Don't invent state.

Extra instructions from the user, if any: $ARGUMENTS
If they include "overnight" or "while I'm away", use mode `OVERNIGHT_SAFE` instead.

Continue through safe steps without asking. When you stop, report: state reached, what was done, evidence paths, and exactly what the human must decide or do.
