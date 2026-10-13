---
name: jmw-finance-review
description: Review supplied finance, treasurer, AP, or month-end files and stop at human exception review. Never posts entries or pays anything. Use when the user asks for a finance, treasurer, AP, or month-end review.
argument-hint: "[path to the folder of copied exports/documents]"
---

Run the JMW Project Manager loop in **FINANCE_REVIEW** mode.

Use the `jmw-project-manager` agent with this run request:

```yaml
command: jmw-finance-review
mode: FINANCE_REVIEW
target: EXCEPTION_REVIEW (human gate)
inputs: "$ARGUMENTS"
```

Rules for this command:
- Work only from supplied copies/exports. No live payment systems. No posting, no payments, no changes to books or source documents (L3/L4 are out of scope for this command entirely).
- Route to `ap-reviewer` for payment/check-request packages, `treasurer-reviewer` for broader review, `month-end-reviewer` for close/reconciliation. `board-report-writer` only after a human has reviewed exceptions.
- Use the evidence statuses in `FINANCE-STANDARDS.md`. Never call anything "approved" without documented human approval.
- Follow `.jmw/orchestration/PM-LOOP.md` (or `orchestration/PM-LOOP.md` in the master repo).
