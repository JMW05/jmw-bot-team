# Tales from the CRUE / Cool Crue Game

## Type
Game project. This profile currently treats “The Cool Crue” references as the Tales from the CRUE game context; if those are separate projects, split this profile before syncing it into production repos.

## Engine / current technical context
Godot project. Existing work has included combat SpriteFrames, Combat Lab review, automated tests, and art cleanup workflows.

## Visual authority
For Jazz combat motion, the Combat Bible defines which moves/beats exist. The `tot-crue-reference/CRUE_Jazz_Move_References_2026-09-14` folder is the visual-motion authority for how Jazz should actually pose/move when available, including the Half-Draw Slash.

## Critical rule
Do not fake left-facing handedness or missing animation truth in code. If a reference/art problem is unresolved, report it as unresolved.

## Critical QA
- game/scene startup
- controls/input
- combat move availability
- timing and state transitions
- hit/hurt/collision behavior when in scope
- Jazz pose/motion fidelity to references
- sprite alpha/matte/crop integrity
- left/right orientation and handedness
- resolution/UI behavior
- automated tests
- actual engine play verification when the runtime is available

## Verification language
If Godot/runtime cannot be launched, automated/static checks may pass but play/visual verification remains NOT VERIFIED.

## Release guardrail
No export/release/deploy without human approval.