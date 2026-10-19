# Run Log

<!--
Append-only. One line per step. Newest at the bottom. Never rewrite old lines.
Format:
- TIME | TASK_ID | AGENT | LEVEL | RESULT | STATE BEFORE -> AFTER | EVIDENCE | NOTE
LEVEL:  L0 | L1 | L2 | L3 | L4
RESULT: done | partial | failed | blocked | stopped-human-gate | skipped | interrupted
TIME:   include a timezone (Z or +hh:mm) so the Control Room can order it; without one only the label is kept.

Each PM run is bracketed (Bot Ops, BOT-OPS-JMW-HANDOFF.md):
- TIME | RUN-START | R-YYYY-MM-DD-<slug>-NN | jmw-project-manager | MODE | workflow | STATE -> TARGET | resumed_from: R-...|none
- TIME | RUN-END | R-... | succeeded|stopped-human-gate|stopped-no-eligible-work|blocked|budget-exhausted|failed|cancelled | STATE_AT_END | stop reason
A RUN-START with no RUN-END means the run was interrupted. The next run names it in resumed_from.
-->

- YYYY-MM-DD HH:MM | T-000 | jmw-project-manager | L0 | done | INTAKE -> INTAKE | none | JMW state files created
