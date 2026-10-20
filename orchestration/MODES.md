# JMW Modes

A mode is the "how far may we go" setting for one run. The Project Manager picks it from the command (see `COMMANDS.md`) or from what the user says. If the user says "read-only", "don't change anything", or "just check", the mode is **REVIEW** no matter what else was requested.

| Mode | Highest level allowed | Typical use | Never in this mode |
|---|---|---|---|
| **REVIEW** | L0 (+ `.jmw/` state and artifacts) | Inspect, test, report | Source edits, commits, pushes, deploys |
| **FIX** | L1 | Fix approved issues on a feature branch and verify them | Staging deploy, drafts outside the repo, anything L2+ |
| **STAGING** | L2 (only actions the project policy allows) | Fix, then deploy to staging and verify there | Production, sending real email, DNS |
| **LAUNCH_REVIEW** | L0 (+ `.jmw/` state and artifacts) | Final pre-launch check by launch-guard | Deploying, "fixing on the way" |
| **OVERNIGHT_SAFE** | L1 | Unattended work while the owner is away | L2+, anything that would normally pause for a question |
| **FINANCE_REVIEW** | L0 (+ drafts saved in `.jmw/artifacts/`) | Review supplied copies/exports | Posting, payments, changing books or source documents, live payment systems |
| **GAME_BUILD** | L1 | game-builder then game-qa on a feature branch | Export, release, store upload |

## Notes per mode

- **REVIEW** writes only to `.jmw/` (state and artifacts). If the user said "do not modify anything", skip even those writes and put the report in the chat.
- **FIX** never works directly on the production/default branch. Create or reuse a feature branch first.
- **STAGING** needs a `staging_deploy: allowed` line in the project policy (see `PROJECT-POLICY.md`). Without it, STAGING behaves like FIX and stops at "staging deploy needs approval".
- **LAUNCH_REVIEW** ends at the `PRODUCTION_APPROVAL` gate. It never deploys.
- **OVERNIGHT_SAFE** does not wait for answers. When it hits a human gate on one issue, it records the gate in `STATUS.md` and `HANDOFF.md`, marks the issue `needs-human`, and moves to the next eligible L0/L1 item. It stops when nothing eligible is left or the run budget is used. Screen recording is off unless the project policy turns it on.
- **FINANCE_REVIEW** follows `standards/FINANCE-STANDARDS.md`. Proposed journal entries are labeled DRAFT FOR HUMAN REVIEW.
- **GAME_BUILD** may run Godot headless and the project's tests. Play/visual checks that could not actually run stay NOT VERIFIED.
