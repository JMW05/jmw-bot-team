# JMW State Machines

`STATUS.md` always holds exactly one `current_state`. A state changes only when its **exit check** is met **with evidence**, and the Project Manager records the change in `RUN-LOG.md`.

- **Agent** = who normally does the work in that state.
- **Gate** = `auto` (the PM may move on by itself once the exit check passes) or `HUMAN` (the PM stops; only a person moves the project past it).
- A project may extend these in its profile (see `PROJECT-POLICY.md`). Overrides can add states and gates, never remove a HUMAN gate.
- Going **back** is always allowed (for example QA → BUILDING when QA fails). Record why.
- Issue rule used below: "no open P0/P1" means every P0/P1 is `verified`, `wont-fix` with a human decision, or explicitly accepted by the owner in `DECISIONS.md`.

## WEBSITE

| State | Agent | Exit check (with evidence) | Gate to next |
|---|---|---|---|
| INTAKE | jmw-project-manager | Project brief exists; owner, goal and environment known | auto |
| DISCOVERY | site-architect | Build spec written; scope approved by owner | **HUMAN** (scope approval) |
| BUILDING | site-builder | Approved scope implemented on a feature branch; lint/typecheck/tests/build run and results recorded | auto |
| DESIGN_REVIEW | design-director | Design review report saved; P0/P1 design findings logged as issues | auto |
| QA | qa-tester (independent of builder) | QA report saved; no open P0/P1; required viewports and flows exercised or listed as NOT VERIFIED | auto |
| STAGING_READY | site-builder (L2 deploy if allowed) then qa-tester | Same build verified on staging (or, if staging deploy is not allowed, on local preview and the gap stated) | auto |
| OWNER_REVIEW | **owner** | Owner has reviewed the packet and either accepts or sends back issues | **HUMAN** |
| LAUNCH_REVIEW | launch-guard | launch-guard returns READY FOR HUMAN LAUNCH APPROVAL | auto |
| PRODUCTION_APPROVAL | **owner** | Owner explicitly approves production deploy in the current task | **HUMAN** (L3) |
| LIVE | site-builder for the approved deploy, then qa-tester on the live site | Live behavior verified (not just staging) | auto |
| MAINTENANCE | any | Ongoing; new work re-enters at BUILDING or QA | — |

"Owner-review ready" = the project has reached **OWNER_REVIEW** with an owner review packet saved in `.jmw/artifacts/qa-reports/`.

## GAME

| State | Agent | Exit check (with evidence) | Gate to next |
|---|---|---|---|
| CONCEPT | jmw-project-manager | Concept, references and acceptance criteria written | **HUMAN** (concept approval) |
| VERTICAL_SLICE | game-builder | One representative scene/loop implemented; tests and headless run recorded | auto |
| PLAYABLE_BUILD | game-builder | Build starts and is playable end to end for current scope; checks recorded | auto |
| GAME_QA | game-qa (independent) | No open P0/P1; NOT VERIFIED items listed | auto |
| VISUAL_REVIEW | game-qa against references; **owner** where references are ambiguous | Motion/art matches reference authority; ambiguities decided by owner | **HUMAN** if any ambiguity, else auto |
| CONTENT_COMPLETE | game-builder then game-qa | All planned content in; regression QA passed | auto |
| RELEASE_CANDIDATE | **owner** | Owner decides on export/release | **HUMAN** (release is L3) |

## FINANCE

| State | Agent | Exit check (with evidence) | Gate to next |
|---|---|---|---|
| OPEN_PERIOD | jmw-project-manager | Entity, period, source files and authoritative system identified | auto |
| DATA_GATHERING | treasurer-reviewer / ap-reviewer | All requested copies/exports received or listed as Not provided | auto |
| RECONCILIATION | month-end-reviewer | Draft reconciliation and unmatched items list saved | auto |
| EXCEPTION_REVIEW | **human** reviews agent exceptions | Each exception has a human disposition | **HUMAN** |
| TREASURER_REVIEW | **treasurer (human)** | Treasurer signs off on figures and caveats | **HUMAN** |
| CLOSE_READY | month-end-reviewer | Close checklist complete with support, or gaps stated | auto |
| CLOSED | **human** closes the period in the ledger | Period closed by a person in the authoritative system | **HUMAN** (agents never close or post) |
| REPORTING | board-report-writer, then human | Draft board report saved; publication is a person's decision | **HUMAN** (publication is L3) |
