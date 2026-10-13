---
name: jmw-fix-p1
description: Fix and independently verify the open P0 and P1 issues in a JMW project. Use when the user asks to fix the P1s, fix the important or blocking issues, or clear the blockers.
argument-hint: "[optional issue IDs, e.g. ISSUE-012 ISSUE-015]"
---

Run the JMW Project Manager loop in **FIX** mode.

Use the `jmw-project-manager` agent with this run request:

```yaml
command: jmw-fix-p1
mode: FIX
target: no eligible open P0/P1 issues (each one verified by an independent agent, or marked needs-human/blocked with the reason)
issues: "$ARGUMENTS"   # empty = all open P0/P1, highest priority first
```

Rules for this command:
- Highest permission level is L1: edits and commits on a feature branch only, never the production branch.
- Builder fixes, a different agent verifies. An issue is only `verified` after independent verification with evidence.
- Do not ask for approval between ordinary safe steps. Stop only for the stop conditions in `PM-LOOP.md`.
- Follow `.jmw/orchestration/PM-LOOP.md` (or `orchestration/PM-LOOP.md` in the master repo).
