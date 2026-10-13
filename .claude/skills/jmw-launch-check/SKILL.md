---
name: jmw-launch-check
description: 'Run the final pre-launch readiness review and stop at the human production-approval gate, without deploying. Use when the user says "is it ready to launch", "run the launch check", "pre-launch review", or "can we go live".'
---

# /jmw-launch-check

**Mode:** `LAUNCH_REVIEW` (L0 plus `.jmw/` writes; no source edits, no deploys)
**Target state:** `PRODUCTION_APPROVAL` (a human gate). This workflow never goes past it.

Steps:
1. Confirm the owner review is complete (`OWNER_REVIEW` passed, with the owner's sign-off recorded in `DECISIONS.md`). If it isn't, stop and say so. Don't skip owner review.
2. Confirm the exact commit/version that would launch and that it's the one QA verified.
3. Dispatch `launch-guard` with `checklists/launch.md`. Dispatch `qa-tester` for any area without current evidence.
4. Record blockers as P0/P1 issues. Don't fix them in this mode. Recommend `/jmw-fix-p1`.
5. Write `.jmw/artifacts/evidence/YYYY-MM-DD_launch-packet.md`: launch-guard verdict, commit, checks run, rollback plan, DNS/domain impact described (not performed), and items needing human confirmation.
6. If the verdict is `READY FOR HUMAN LAUNCH APPROVAL`, set state `PRODUCTION_APPROVAL` with gate "Approve production deployment of <commit>?". Stop.

Production deployment is L3 and DNS is L4. Neither happens in this workflow.

## How to run this

You (the main conversation) act as the **JMW Project Manager**. Read `.claude/agents/jmw-project-manager.md` and run its execution loop yourself, dispatching specialists with the Agent tool. Don't hand orchestration to the `jmw-project-manager` subagent, because subagents can't launch other subagents.

Rules: `.jmw/standards/ORCHESTRATION-STANDARDS.md` (master repo: `standards/`). States: `.jmw/workflows/STATE-MACHINES.md` (master repo: `workflows/`). All `CLAUDE.md`, security, and finance rules still apply and win any conflict.

If the `.jmw/STATUS.md` state files are missing, say so and tell the user to run the JMW installer for this project. Don't invent state.

Extra instructions from the user, if any: $ARGUMENTS
If they include "overnight" or "while I'm away", use mode `OVERNIGHT_SAFE` instead.

Continue through safe steps without asking. When you stop, report: state reached, what was done, evidence paths, and exactly what the human must decide or do.
