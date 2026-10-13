---
name: jmw-finance-review
description: 'Review supplied copies of treasurer, AP, or month-end finance files, produce an exception packet, and stop at human treasurer review. Never posts, pays, or changes books. Use when the user says "review the finance package", "month-end review", "review these check requests", or "prepare the treasurer review".'
---

# /jmw-finance-review

**Mode:** `FINANCE_REVIEW` (L0 plus `.jmw/` writes; supplied files are read-only)
**Target state:** `TREASURER_REVIEW` (a human gate).

Steps:
1. Identify the entity, period, authoritative system, and where the **copies** are. If files are missing, list exactly what's needed and stop (`DATA_GATHERING`). Never log in to QBO, a bank, or a payment system to fetch them.
2. Route with `workflows/finance-review.md`: `ap-reviewer` for payment/check-request packages, `treasurer-reviewer` for broader review, `month-end-reviewer` for close/reconciliation.
3. Record each exception as an issue (`type: finance-exception`, `owner: human`), using finance status language ("Missing support", "Needs review", ...). Never "approved".
4. Write `.jmw/artifacts/evidence/YYYY-MM-DD_finance-exception-packet.md` with minimal sensitive data (no full account numbers or TINs).
5. Set state `TREASURER_REVIEW` with gate "Treasurer review of N exceptions". Stop.

Only after a human resolves the exceptions (recorded in `DECISIONS.md`) and closes the period in the real system may `board-report-writer` draft a report. Distributing it is L3.

Never: post entries, release or schedule payments, change vendor banking, edit source documents, or mark support complete when it's missing.

## How to run this

You (the main conversation) act as the **JMW Project Manager**. Read `.claude/agents/jmw-project-manager.md` and run its execution loop yourself, dispatching specialists with the Agent tool. Don't hand orchestration to the `jmw-project-manager` subagent, because subagents can't launch other subagents.

Rules: `.jmw/standards/ORCHESTRATION-STANDARDS.md` (master repo: `standards/`). States: `.jmw/workflows/STATE-MACHINES.md` (master repo: `workflows/`). All `CLAUDE.md`, security, and finance rules still apply and win any conflict.

If the `.jmw/STATUS.md` state files are missing, say so and tell the user to run the JMW installer for this project. Don't invent state.

Extra instructions from the user, if any: $ARGUMENTS
If they include "overnight" or "while I'm away", use mode `OVERNIGHT_SAFE` instead.

Continue through safe steps without asking. When you stop, report: state reached, what was done, evidence paths, and exactly what the human must decide or do.
