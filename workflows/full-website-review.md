# Full Website Review Workflow

Use when the user says “run the full JMW web team,” “pre-launch review,” or equivalent.

1. Read matching project profile and project CLAUDE instructions.
2. Confirm environment: local, staging, or production.
3. `design-director` reviews visual/UX quality independently. No edits.
4. `qa-tester` independently verifies current behavior. It must not rely on design/builder claims.
5. Project Manager consolidates P0/P1/P2/P3 without erasing disagreements.
6. If the user authorizes fixes, send only approved findings to `site-builder`.
7. Re-run the failed/relevant Design or QA checks after fixes.
8. `launch-guard` reviews release readiness.
9. Stop at `READY FOR HUMAN LAUNCH APPROVAL`; do not deploy unless the user explicitly authorizes production deployment.

Use `templates/reports/JMW-REVIEW.md`.