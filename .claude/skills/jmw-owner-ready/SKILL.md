---
name: jmw-owner-ready
description: 'Drive a website project to the OWNER_REVIEW state: fix blockers, verify independently, get it onto staging when allowed, and prepare the owner-review packet. Use when the user says "get this owner-review ready", "get it ready for the owner to look at", "make it ready for client review", or similar.'
---

# /jmw-owner-ready

**Target state:** `OWNER_REVIEW` (website machine).
**Mode:** `STAGING` if `PROJECT.md` `l2_allowed` includes `staging-deploy` or an active `DECISIONS.md` authorization allows it. Otherwise `FIX`, which stops at `STAGING_READY` and asks for staging approval.

"Owner-review ready" means all of:
- no open P0/P1 issues (or each one explicitly accepted by a human in `DECISIONS.md`);
- `design-director` and `qa-tester` passes on **staging**, not just local;
- the project's `check_commands` pass on the deployed commit;
- an owner-review packet at `.jmw/artifacts/evidence/YYYY-MM-DD_owner-review-packet.md`.

Steps:
1. Establish the true current state from evidence. Don't re-do verified work.
2. If there are no current findings, run `/jmw-review` behavior first (design-director + qa-tester).
3. Run `/jmw-fix-p1` behavior until no eligible P0/P1 remain.
4. Enter `STAGING_READY` when exit evidence exists.
5. Staging deploy:
   - allowed (L2) → deploy with the project's documented staging command, record the version/commit, then have `qa-tester` (and `design-director` for visual P0/P1 areas) re-verify **on staging**;
   - not allowed → stop. Gate: "Approve a staging deploy of commit X?"
6. Write the owner-review packet in plain English for a non-technical owner: what to look at (URLs and paths), what changed, known limitations, decisions the owner needs to make (from `needs-human` issues and open policy questions), and evidence links. No secrets, no private customer data.
7. Set state `OWNER_REVIEW` and `human_gate: owner review of <staging URL>`. Stop.

Never deploy production, change DNS, weaken auth/Access, send real customer email, or invent prices/policy to get there.

## How to run this

You (the main conversation) act as the **JMW Project Manager**. Read `.claude/agents/jmw-project-manager.md` and run its execution loop yourself, dispatching specialists with the Agent tool. Don't hand orchestration to the `jmw-project-manager` subagent, because subagents can't launch other subagents.

Rules: `.jmw/standards/ORCHESTRATION-STANDARDS.md` (master repo: `standards/`). States: `.jmw/workflows/STATE-MACHINES.md` (master repo: `workflows/`). All `CLAUDE.md`, security, and finance rules still apply and win any conflict.

If the `.jmw/STATUS.md` state files are missing, say so and tell the user to run the JMW installer for this project. Don't invent state.

Extra instructions from the user, if any: $ARGUMENTS
If they include "overnight" or "while I'm away", use mode `OVERNIGHT_SAFE` instead.

Continue through safe steps without asking. When you stop, report: state reached, what was done, evidence paths, and exactly what the human must decide or do.
