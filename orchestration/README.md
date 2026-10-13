# JMW Orchestration (Phase 2)

This folder turns the JMW agents from a toolbox into a team with a manager. It adds **no new agents**. It adds rules and a memory so the existing `jmw-project-manager` can keep work moving safely until a person is genuinely needed.

## The idea in plain English

1. Each project keeps a small **notebook** in `.jmw/`: where it stands (`STATUS.md`), what people decided (`DECISIONS.md`), what is wrong (`OPEN-ISSUES.md`), what the next session needs to know (`HANDOFF.md`), and a diary of every step (`RUN-LOG.md`).
2. Every action has a **level** from L0 (just looking) to L4 (never done by an agent). See `PERMISSIONS.md`.
3. Every run has a **mode** that caps the level, such as REVIEW (look only) or FIX (edit on a feature branch). See `MODES.md`.
4. Every project moves through **states** like QA → STAGING_READY → OWNER_REVIEW. Some states are **human gates** where the agents must stop. See `STATE-MACHINES.md`.
5. The manager hands work to specialists on a short **task card** and gets a short **result card** back. See `TASK-CONTRACT.md`.
6. The manager follows one **loop**: read the notebook, check reality, pick the most important safe thing, send it to the right specialist, have someone else verify it, save evidence, update the notebook, and repeat until a human gate. See `PM-LOOP.md`.
7. You start a run with a **command** or the same words in plain English, such as "Get this owner-review ready." See `COMMANDS.md`.

## Architecture

```
You: "Get this project owner-review ready."
        │  (plain words or /jmw-owner-ready; both load the same skill)
        ▼
.claude/skills/jmw-owner-ready  ──►  jmw-project-manager  (runs PM-LOOP.md)
                                        │ reads/writes
                                        ├── .jmw/PROJECT.md      profile + JMW POLICY (synced from master)
                                        ├── .jmw/STATUS.md       where we are   ┐
                                        ├── .jmw/DECISIONS.md    what people decided │ project-owned,
                                        ├── .jmw/OPEN-ISSUES.md  what is wrong    │ never overwritten
                                        ├── .jmw/HANDOFF.md      next-session notes │ by the installer
                                        ├── .jmw/RUN-LOG.md      every step       ┘
                                        │
                                        │ checks PERMISSIONS (L0–L4) × MODE × project policy
                                        │
                                        │ TASK ENVELOPE ─►  specialist (site-builder, game-builder, ...)
                                        │ ◄─ RESULT ENVELOPE
                                        │ TASK ENVELOPE ─►  independent verifier (qa-tester, game-qa, design-director, launch-guard)
                                        │ ◄─ RESULT ENVELOPE + evidence in .jmw/artifacts/
                                        │
                                        └── repeat ... until a HUMAN gate ──► stops and tells you exactly what it needs
```

## What is framework vs. project

| Owned by the master repo (refreshed on every sync) | Owned by each project (created once, never overwritten) |
|---|---|
| `.claude/agents/`, `.claude/skills/jmw-*`, `.jmw/standards/`, `.jmw/checklists/`, `.jmw/workflows/`, `.jmw/orchestration/`, `.jmw/PROJECT.md`, `.jmw/JMW-MASTER.md`, `.jmw/JMW-INCLUDE.md`, `.jmw/handoff-snapshots/` | `.jmw/STATUS.md`, `.jmw/DECISIONS.md`, `.jmw/OPEN-ISSUES.md`, `.jmw/HANDOFF.md`, `.jmw/RUN-LOG.md`, `.jmw/artifacts/`, the project's root `CLAUDE.md` |

## Files here

| File | What it is |
|---|---|
| `PERMISSIONS.md` | L0–L4 action levels |
| `MODES.md` | REVIEW, FIX, STAGING, LAUNCH_REVIEW, OVERNIGHT_SAFE, FINANCE_REVIEW, GAME_BUILD |
| `STATE-MACHINES.md` | Website, game and finance states and gates |
| `PROJECT-POLICY.md` | The per-project policy block and state overrides |
| `TASK-CONTRACT.md` | Task and result envelopes |
| `PM-LOOP.md` | The project manager's loop and stop conditions |
| `COMMANDS.md` | The six commands and the plain-English phrases that trigger them |
| `ARTIFACTS.md` | Where evidence goes and what must never be captured |
| `JMW-INCLUDE.md` | Short note installed as `.jmw/JMW-INCLUDE.md` for a project's `CLAUDE.md` to import |
| `PILOT-LAVISH.md` | Paper walk-through of an owner-ready run using Lavish as the reference |
