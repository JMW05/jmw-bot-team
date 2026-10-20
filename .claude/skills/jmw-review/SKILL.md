---
name: jmw-review
description: Review a JMW project without changing it. Use when the user asks to review, check, audit, or get the status of the project, or says read-only / don't change anything / just check.
argument-hint: "[optional focus, e.g. mobile, checkout, finance package]"
---

Run the JMW Project Manager loop in **REVIEW** mode.

Use the `jmw-project-manager` agent with this run request:

```yaml
command: jmw-review
mode: REVIEW
target: a JMW-REVIEW report of the current state; no state advance unless evidence shows the recorded state is wrong
focus: "$ARGUMENTS"
```

Rules for this command:
- Highest permission level is L0. The only writes allowed are `.jmw/` state files and `.jmw/artifacts/`. If the user said not to modify anything, make no writes at all and put the report in the chat.
- Route to the reviewers that fit the workflow (design-director and qa-tester for websites, game-qa for games, treasurer-reviewer / ap-reviewer / month-end-reviewer for finance). No builders.
- Follow `.jmw/orchestration/PM-LOOP.md` (or `orchestration/PM-LOOP.md` in the master repo).
- End with the plain-English summary the loop describes.
