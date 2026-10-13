# Project Status

The JMW Project Manager rewrites this file at the end of every run. Read "In plain English" first. The YAML block is for routing, so keep its keys and use one line per value.

```yaml
project: {{PROJECT_SLUG}}
domain: unknown
current_state: NOT_STARTED
target_state: none
mode: REVIEW
environment: local
branch: unknown
last_updated: {{INSTALL_DATE}}
last_run: none
open_p0: 0
open_p1: 0
human_gate: none
```

<!--
domain:        website | game | finance | unknown (until the first run)
current_state: a state from .jmw/workflows/STATE-MACHINES.md (plus PROJECT.md extras), or NOT_STARTED
target_state:  the state the current request is aiming for, or none
mode:          REVIEW | FIX | STAGING | LAUNCH_REVIEW | OVERNIGHT_SAFE | FINANCE_REVIEW | GAME_BUILD
environment:   local | staging | production | supplied-files
open_p0/p1:    issues in OPEN-ISSUES.md at that priority that are not verified or wont-fix
human_gate:    none, or ONE line saying exactly what is waiting on a human
-->

## In plain English
Not started. JMW state files were just installed.

## Waiting on you
Nothing yet.

## What happens next
Ask the Project Manager for a goal, for example: "Review this project" or "Get this owner-review ready."
