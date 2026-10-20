# Project Status

<!--
This file is the project's "you are here" marker.
The JMW Project Manager reads it first and rewrites the CURRENT block after every step.
Keep the "key: value" lines exactly in this shape so the agents can read them.
Allowed values are listed in .jmw/orchestration/STATE-MACHINES.md and MODES.md.
-->

## CURRENT
- project: (project slug, e.g. lavish)
- workflow: website            <!-- website | game | finance -->
- current_state: INTAKE        <!-- a state from the workflow's state machine -->
- target_state: (none)         <!-- where the current request is trying to get to -->
- mode: REVIEW                 <!-- REVIEW | FIX | STAGING | LAUNCH_REVIEW | OVERNIGHT_SAFE | FINANCE_REVIEW | GAME_BUILD -->
- environment: local           <!-- local | staging | production | supplied-files -->
- branch: (current git branch)
- commit: (short commit hash last checked)
- open_p0: 0
- open_p1: 0
- waiting_on_human: no         <!-- yes | no -->
- human_gate: (none)           <!-- what the human must decide or do, in one line -->
- next_action: (one line)
- last_updated: (YYYY-MM-DD HH:MM, timezone)
- updated_by: (agent name or person)

## IN PLAIN ENGLISH
(Two or three sentences a non-engineer can read: where the project stands, what was just done, and what happens next.)

## VERIFIED vs NOT VERIFIED
- Verified (observed or tested, with evidence link):
  - (none yet)
- Not verified / blocked:
  - (none yet)
