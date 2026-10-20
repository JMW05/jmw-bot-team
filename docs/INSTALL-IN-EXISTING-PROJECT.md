# Install JMW Agents in an Existing Project

The master repo is the canonical source. Existing project repos receive a synced copy of `.claude/agents/` plus an optional project profile/addendum.

## Windows
From a local clone of `jmw-bot-team`:

```powershell
.\scripts\install-jmw-agents.ps1 -TargetPath "C:\path\to\project" -ProjectSlug "lavish"
```

The installer:
- creates `.claude/agents/` in the target;
- copies current master agents;
- creates `.jmw/PROJECT.md` from the chosen profile;
- creates `.jmw/CLAUDE-ADDENDUM.md` from the matching project addendum;
- copies the JMW command skills (`.claude/skills/jmw-*` only; other skills are left alone);
- copies `orchestration/` to `.jmw/orchestration/` and `JMW-INCLUDE.md` to `.jmw/JMW-INCLUDE.md`;
- creates the project state files `.jmw/STATUS.md`, `DECISIONS.md`, `OPEN-ISSUES.md`, `HANDOFF.md`, `RUN-LOG.md` and the `.jmw/artifacts/` folders **only if they are missing**. Existing project state is never overwritten;
- writes `.jmw/local/jmw-master.json`, a workstation-local pointer to this master repo's capability state, checker and reader (`.jmw/local/` ignores itself in git; no capability state is copied into the project);
- seeds a missing `.jmw/HANDOFF.md` from the newest `projects/handoffs/<slug>-*.md` snapshot, and always copies the snapshots to `.jmw/handoff-snapshots/` for reference;
- does NOT overwrite the target's existing `CLAUDE.md`.

Then add this one line to the target `CLAUDE.md` (Claude Code imports the file it points to):

```
@.jmw/JMW-INCLUDE.md
```

Or ask Claude Code to read `.jmw/JMW-INCLUDE.md` and `.jmw/CLAUDE-ADDENDUM.md` explicitly.

## Check the installed state

```powershell
.\scripts\check-jmw-state.ps1 -ProjectPath "C:\path\to\project"
```

This is read-only. It reports missing state files and malformed issues (for example an issue marked verified with no verifier).

## Test the installer

```powershell
pwsh -File .\tests\test-installer.ps1
```

Runs only in temporary folders.

## Safe rollout
Test one project first (recommended: Lavish) before syncing every repo. Commit agent installation on a feature branch so changes are reviewable.

## Canonical-source rule
Edit agent definitions in `jmw-bot-team` first, then sync outward. Do not hand-edit copied agents in individual projects unless the change is intentionally project-specific.