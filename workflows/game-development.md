# Game Development Workflow

1. Read the game project profile, project CLAUDE instructions, design/combat bible, and visual reference authority.
2. Inspect the engine/project version and current repository before changing anything.
3. For major features, define acceptance criteria before implementation.
4. `game-builder` implements the approved scope.
5. Run automated tests/static validation/build checks available in the environment.
6. `game-qa` independently verifies gameplay/visual behavior. If engine/runtime is unavailable, mark play verification NOT VERIFIED.
7. Builder fixes only approved findings.
8. Re-run affected game QA.
9. Stop for human review before release/export/deployment.

Never fake missing art, pose truth, handedness, runtime evidence, or visual verification.