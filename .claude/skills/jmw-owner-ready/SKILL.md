---
name: jmw-owner-ready
description: Take a JMW project as far as it can safely go toward owner review, then stop at the owner's decision. Use when the user says get this owner-review ready, get it ready for me (or the client) to review, or make it ready to show the owner.
argument-hint: "[optional notes, e.g. focus on the quote flow]"
---

Run the JMW Project Manager loop toward the **owner-review gate**.

Use the `jmw-project-manager` agent with this run request:

```yaml
command: jmw-owner-ready
mode: FIX            # use STAGING instead only if .jmw/PROJECT.md policy says staging_deploy: allowed
target:
  website: OWNER_REVIEW
  game: RELEASE_CANDIDATE
  finance: EXCEPTION_REVIEW
notes: "$ARGUMENTS"
```

Rules for this command:
- Work through every authorized safe step (L0/L1, plus L2 only where policy allows): fix open P0/P1 issues, run design review and independent QA, capture evidence, update `.jmw/` state.
- Do not ask for approval after ordinary safe steps. Stop only for the stop conditions in `PM-LOOP.md`.
- When the target is reached, save the owner review packet to `.jmw/artifacts/qa-reports/` and tell the user exactly what they need to look at and decide.
- If the target cannot be reached, stop at the first legitimate human gate and say what is needed, in one or two plain sentences.
- Follow `.jmw/orchestration/PM-LOOP.md` (or `orchestration/PM-LOOP.md` in the master repo).
