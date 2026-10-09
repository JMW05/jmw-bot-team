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
- does NOT overwrite the target's existing `CLAUDE.md`.

Then add the short include instruction from `.jmw/CLAUDE-ADDENDUM.md` to the target `CLAUDE.md`, or ask Claude Code to read that file explicitly.

## Safe rollout
Test one project first (recommended: Lavish) before syncing every repo. Commit agent installation on a feature branch so changes are reviewable.

## Canonical-source rule
Edit agent definitions in `jmw-bot-team` first, then sync outward. Do not hand-edit copied agents in individual projects unless the change is intentionally project-specific.