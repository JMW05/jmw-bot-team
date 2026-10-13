---
name: jmw-launch-check
description: Run the JMW pre-launch check and stop at the production approval gate without deploying. Use when the user asks if the project is ready to launch, wants a launch check, or a pre-launch review.
argument-hint: "[optional: environment or commit to check]"
---

Run the JMW Project Manager loop in **LAUNCH_REVIEW** mode.

Use the `jmw-project-manager` agent with this run request:

```yaml
command: jmw-launch-check
mode: LAUNCH_REVIEW
target: PRODUCTION_APPROVAL gate (stop there)
notes: "$ARGUMENTS"
```

Rules for this command:
- Highest permission level is L0 (plus `.jmw/` state and artifacts). Never deploy, never change DNS, never "fix on the way".
- Route to `launch-guard`, using the launch checklist. Ask qa-tester for any missing verification first.
- End with launch-guard's status (READY FOR HUMAN LAUNCH APPROVAL / CONDITIONALLY READY / NOT READY), blockers, and the exact decision the owner must make.
- Follow `.jmw/orchestration/PM-LOOP.md` (or `orchestration/PM-LOOP.md` in the master repo).
