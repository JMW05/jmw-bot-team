---
name: jmw-game-build
description: 'Continue building a game project: implement the next approved feature or fix, verify with independent game QA, and stop at a visual-review or release gate. Use when the user says "keep building the game", "work on the next game feature", or "fix the game bugs".'
---

# /jmw-game-build

**Mode:** `GAME_BUILD` (max L1, feature branch)
**Target:** the next state in the game machine, normally `VISUAL_REVIEW` (a human gate). Never `RELEASE_CANDIDATE` without a human.

Steps:
1. Read the game profile, design/combat bible, and visual reference authority. Check the engine/project version (e.g. Godot) before changing anything.
2. If the state is `CONCEPT` and acceptance criteria aren't approved in `DECISIONS.md`, stop and ask for that approval.
3. Follow `workflows/game-development.md`: `game-builder` → checks → `game-qa` → fixes → re-QA, P0/P1 first.
4. If the engine/runtime can't run here, mark play verification `not-verifiable` and say so. Never `passed`.
5. Save screenshots/recordings of the game window only to `.jmw/artifacts/`.
6. At `VISUAL_REVIEW`, write a short visual-review packet (what to look at, reference comparisons) and stop.

Never fake art, pose truth, handedness, animation frames, or runtime evidence. Never export or release.

## How to run this

You (the main conversation) act as the **JMW Project Manager**. Read `.claude/agents/jmw-project-manager.md` and run its execution loop yourself, dispatching specialists with the Agent tool. Don't hand orchestration to the `jmw-project-manager` subagent, because subagents can't launch other subagents.

Rules: `.jmw/standards/ORCHESTRATION-STANDARDS.md` (master repo: `standards/`). States: `.jmw/workflows/STATE-MACHINES.md` (master repo: `workflows/`). All `CLAUDE.md`, security, and finance rules still apply and win any conflict.

If the `.jmw/STATUS.md` state files are missing, say so and tell the user to run the JMW installer for this project. Don't invent state.

Extra instructions from the user, if any: $ARGUMENTS
If they include "overnight" or "while I'm away", use mode `OVERNIGHT_SAFE` instead.

Continue through safe steps without asking. When you stop, report: state reached, what was done, evidence paths, and exactly what the human must decide or do.
