# JMW State Machines

Each project is in exactly one state, recorded in `.jmw/STATUS.md` as `current_state`.

- The PM moves a project forward only when the **exit evidence** for its current state exists.
- Specialists may *recommend* a transition. Only the PM records one.
- **Gate** states need a human to act before the project leaves them. Agents can prepare the packet but can't pass the gate.
- Going backward is normal (QA fails → back to `BUILDING`). Record why in `RUN-LOG.md`.

The YAML blocks below are what `scripts/validate-jmw-state.py` reads. Keep them in sync with the tables.

---

## Website

| State | Meaning | Who works | Exit evidence → next |
|---|---|---|---|
| `INTAKE` | Request received | PM | brief/profile exists → `DISCOVERY` |
| `DISCOVERY` | Spec being written | site-architect | spec + **human scope approval** (gate) → `BUILDING` |
| `BUILDING` | Approved scope being built/fixed | site-builder | checks pass, issues `fixed-unverified` → `DESIGN_REVIEW` |
| `DESIGN_REVIEW` | Independent visual review | design-director | no open design P0/P1 → `QA` (else back to `BUILDING`) |
| `QA` | Independent functional verification | qa-tester | no open P0/P1, required checks run → `STAGING_READY` |
| `STAGING_READY` | Verified locally / on branch, ready for staging | PM | staging deploy (L2 if allowed, otherwise **human**), then QA re-verifies **on staging** → `OWNER_REVIEW` |
| `OWNER_REVIEW` | Owner-review packet ready, owner looking | **human (owner)** | owner sign-off or change list (gate). Changes → `BUILDING`. Sign-off → `LAUNCH_REVIEW` |
| `LAUNCH_REVIEW` | Final readiness review | launch-guard | `READY FOR HUMAN LAUNCH APPROVAL` → `PRODUCTION_APPROVAL` |
| `PRODUCTION_APPROVAL` | Waiting for go/no-go | **human** | explicit production approval for this task (gate, L3) → `LIVE` |
| `LIVE` | Production deployed and verified on production | PM, qa-tester | post-launch check done → `MAINTENANCE` |
| `MAINTENANCE` | Ongoing small changes | all | new work re-enters at `BUILDING` |

"Owner-review ready" means **entering `OWNER_REVIEW`**: staging verified on staging, no open P0/P1 (or each one explicitly accepted by a human in `DECISIONS.md`), and an owner-review packet at `.jmw/artifacts/evidence/`.

```yaml
machine: website
states:
  - INTAKE
  - DISCOVERY
  - BUILDING
  - DESIGN_REVIEW
  - QA
  - STAGING_READY
  - OWNER_REVIEW
  - LAUNCH_REVIEW
  - PRODUCTION_APPROVAL
  - LIVE
  - MAINTENANCE
human_gates:
  - DISCOVERY
  - OWNER_REVIEW
  - PRODUCTION_APPROVAL
```

---

## Game

| State | Meaning | Who works | Exit evidence → next |
|---|---|---|---|
| `CONCEPT` | Idea, references, acceptance criteria | PM, human | **human approves concept + acceptance criteria** (gate) → `VERTICAL_SLICE` |
| `VERTICAL_SLICE` | One small fully-working slice | game-builder | slice runs, checks pass → `PLAYABLE_BUILD` |
| `PLAYABLE_BUILD` | Build that a person can play end to end | game-builder | build/validation passes → `GAME_QA` |
| `GAME_QA` | Independent gameplay verification | game-qa | no open P0/P1, runtime verified or marked NOT VERIFIED → `VISUAL_REVIEW` |
| `VISUAL_REVIEW` | Art/animation/visual fidelity vs. references | game-qa + **human** | human visual sign-off (gate) → `CONTENT_COMPLETE` (or back to `PLAYABLE_BUILD`) |
| `CONTENT_COMPLETE` | All planned content in | game-builder, game-qa | full QA pass → `RELEASE_CANDIDATE` |
| `RELEASE_CANDIDATE` | Ready for release decision | **human** | release/export is human-approved (gate) |

```yaml
machine: game
states:
  - CONCEPT
  - VERTICAL_SLICE
  - PLAYABLE_BUILD
  - GAME_QA
  - VISUAL_REVIEW
  - CONTENT_COMPLETE
  - RELEASE_CANDIDATE
human_gates:
  - CONCEPT
  - VISUAL_REVIEW
  - RELEASE_CANDIDATE
```

---

## Finance

AI work in this machine stays analysis-only. Agents never post, pay, close the books, or change the authoritative ledger.

| State | Meaning | Who works | Exit evidence → next |
|---|---|---|---|
| `OPEN_PERIOD` | Period/entity identified | PM | entity, period, authoritative system named → `DATA_GATHERING` |
| `DATA_GATHERING` | Collecting **copies** of exports/support | PM, **human supplies files** | required copies present in the review folder → `RECONCILIATION` (logins needed = stop) |
| `RECONCILIATION` | Draft reconciliations from copies | month-end-reviewer | draft recs + unmatched list → `EXCEPTION_REVIEW` |
| `EXCEPTION_REVIEW` | Exceptions, missing support, duplicates, coding questions | ap-reviewer / treasurer-reviewer | exception packet at `.jmw/artifacts/evidence/` → `TREASURER_REVIEW` |
| `TREASURER_REVIEW` | Human treasurer reviews exceptions | **human** | each exception resolved or accepted by a human (gate) → `CLOSE_READY` |
| `CLOSE_READY` | Nothing material open | PM | human closes the period in the real system → `CLOSED` |
| `CLOSED` | Period closed **by a human** | **human** | (gate) → `REPORTING` |
| `REPORTING` | Board report draft | board-report-writer | draft delivered. Distribution is external publication (L3) |

```yaml
machine: finance
states:
  - OPEN_PERIOD
  - DATA_GATHERING
  - RECONCILIATION
  - EXCEPTION_REVIEW
  - TREASURER_REVIEW
  - CLOSE_READY
  - CLOSED
  - REPORTING
human_gates:
  - TREASURER_REVIEW
  - CLOSE_READY
  - CLOSED
```

---

## Project overrides

A project profile (`projects/<slug>.md` in the master repo, installed as `.jmw/PROJECT.md`) can add an orchestration block:

````markdown
## JMW Orchestration

```yaml
domain: website
l2_allowed: none
check_commands: npm run check
extra_states:
  - LIVE_EMAIL_QA after OWNER_REVIEW
extra_gates:
  - LIVE_EMAIL_QA
skip_states: none
```
````

- `domain`: `website`, `game`, or `finance`.
- `l2_allowed`: `none`, or a list of specific L2 actions (e.g. `staging-deploy`, `email-draft`). Anything not listed is not allowed.
- `check_commands`: the project's real verification command(s).
- `extra_states`: `NEW_STATE after EXISTING_STATE`. Inserts a state.
- `extra_gates`: makes added (or existing) states human gates.
- `skip_states`: states this project doesn't use. **Human gate states can never be skipped.**
