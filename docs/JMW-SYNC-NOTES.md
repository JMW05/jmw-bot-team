# JMW Sync Notes

The installer copies the current JMW agents plus shared standards, checklists, workflows, report template, and the selected project profile into `.jmw/` inside each target project.

Installed projects should use `.jmw/` as the local support bundle:

- `.jmw/PROJECT.md`
- `.jmw/CLAUDE-ADDENDUM.md`
- `.jmw/JMW-MASTER.md`
- `.jmw/standards/`
- `.jmw/checklists/`
- `.jmw/workflows/`
- `.jmw/templates/reports/JMW-REVIEW.md`
- `.jmw/orchestration/`
- `.jmw/JMW-INCLUDE.md`
- `.jmw/handoff-snapshots/`
- `.jmw/local/jmw-master.json` (pointer to the master repo's capability state, checker and reader; `.jmw/local/` ignores itself in git, so it is never committed)

Project-owned state (created once if missing, never overwritten by a sync):

- `.jmw/STATUS.md`
- `.jmw/DECISIONS.md`
- `.jmw/OPEN-ISSUES.md`
- `.jmw/HANDOFF.md`
- `.jmw/RUN-LOG.md`
- `.jmw/artifacts/`

Capability state is never copied into a project. The Project Manager reads the master repo's `config/capabilities.json` through the pointer, with the freshness rule in `docs/CAPABILITIES.md`.

Agents should prefer `.jmw/...` paths when running inside a synced project and fall back to the master repo paths when running inside `jmw-bot-team` itself.
