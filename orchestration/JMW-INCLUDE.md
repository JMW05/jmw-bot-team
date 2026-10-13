# JMW Bot Team (installed bundle)

This project uses the JMW Bot Team. The JMW files live in `.jmw/` and are synced from the master `jmw-bot-team` repository.

- Project profile and policy: `.jmw/PROJECT.md` (and `.jmw/CLAUDE-ADDENDUM.md` when present)
- Project state: `.jmw/STATUS.md`, `.jmw/DECISIONS.md`, `.jmw/OPEN-ISSUES.md`, `.jmw/HANDOFF.md`, `.jmw/RUN-LOG.md`
- Rules: `.jmw/JMW-MASTER.md`, `.jmw/standards/`, `.jmw/orchestration/`
- Evidence: `.jmw/artifacts/`

When the user asks for multi-step project work, use the `jmw-project-manager` agent and the JMW commands in `.jmw/orchestration/COMMANDS.md`. For example, "Get this owner-review ready" means `/jmw-owner-ready`.

The project's own `CLAUDE.md` and every existing JMW safety rule take priority. Production deploys, sending email, accounting postings, and permission changes need the owner's explicit approval in the current task. Payments, DNS changes, destructive operations, secret changes, and paid resources are never done by an agent.
