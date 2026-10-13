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
- `.jmw/templates/jmw-state/` (state-file block formats)
- `.jmw/handoffs/` (dated handoff snapshots from `projects/handoffs/`)
- `.claude/skills/jmw-*/` (goal workflows, refreshed each sync)

### Framework-owned vs. project-owned
Refreshed on every sync (don't hand-edit in projects): `.claude/agents/`, `.claude/skills/jmw-*`, `.jmw/standards/`, `.jmw/checklists/`, `.jmw/workflows/`, `.jmw/templates/`, `.jmw/handoffs/`, `.jmw/JMW-MASTER.md`, `.jmw/PROJECT.md`, `.jmw/CLAUDE-ADDENDUM.md`.

Created once, then **never overwritten** (project state): `.jmw/STATUS.md`, `DECISIONS.md`, `OPEN-ISSUES.md`, `HANDOFF.md`, `RUN-LOG.md`, and everything in `.jmw/artifacts/`. The project's root `CLAUDE.md` is never touched.

Change from Phase 1: dated handoff snapshots used to overwrite `.jmw/HANDOFF.md` on every sync. They now go to `.jmw/handoffs/`, and `HANDOFF.md` belongs to the project.

Agents should prefer `.jmw/...` paths when running inside a synced project and fall back to the master repo paths when running inside `jmw-bot-team` itself.
