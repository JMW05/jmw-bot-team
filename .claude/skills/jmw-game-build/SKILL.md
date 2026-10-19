---
name: jmw-game-build
description: Continue building a JMW game project with game-builder and independent game-qa until the next human gate. Use when the user asks to keep building the game, get a build playable, or work on the game (including overnight).
argument-hint: "[target game state or feature, e.g. PLAYABLE_BUILD or Jazz half-draw slash]"
---

Run the JMW Project Manager loop in **GAME_BUILD** mode (use **OVERNIGHT_SAFE** if the user says they will be away).

Use the `jmw-project-manager` agent with this run request:

```yaml
command: jmw-game-build
mode: GAME_BUILD
target: "$ARGUMENTS"   # a game state from STATE-MACHINES.md, or a feature; empty = next state
```

Rules for this command:
- Highest permission level is L1: feature branch only. No export, release, or store upload.
- game-builder implements; game-qa verifies independently. Run Godot headless and project tests where available. Play/visual checks that could not actually run stay NOT VERIFIED.
- Never fake art, handedness, animation frames, or runtime evidence. Reference ambiguity is a human decision.
- Resource preflight is required before every heavy step (Godot headless, capture/FFmpeg, ImageMagick, browser, big test runs): `jmw-preflight.mjs` or `jmw-run.mjs spawn`. A refusal (exit 3) blocks that step; never run it anyway or lower the thresholds.
- Open and close the run with `jmw-run.mjs start` / `end` (RUN-START / RUN-END in RUN-LOG.md). After two interrupted runs in a row the next start ends `blocked`: stop and report, do not retry.
- Follow `.jmw/orchestration/PM-LOOP.md` (or `orchestration/PM-LOOP.md` in the master repo).
