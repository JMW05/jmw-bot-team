# JMW Commands

Each command is installed as a Claude Code skill in `.claude/skills/jmw-*/`. You can type the slash command **or** say it in plain words; Claude matches the words to the skill.

| Command | Say it like this | Mode | Target / stops at |
|---|---|---|---|
| `/jmw-review` | "Review this project", "What's the status?", "Check it but don't change anything" | REVIEW | A JMW-REVIEW report; state recorded, nothing changed |
| `/jmw-fix-p1` | "Fix the P1s", "Fix the important issues", "Clear the blockers" | FIX | No eligible open P0/P1 left (each verified, or waiting on a human) |
| `/jmw-owner-ready` | "Get this owner-review ready", "Get it ready for me to look at", "Make it ready for the client to review" | FIX, or STAGING if policy allows | Website: OWNER_REVIEW. Game: RELEASE_CANDIDATE. Finance: EXCEPTION_REVIEW |
| `/jmw-launch-check` | "Is it ready to launch?", "Run the launch check", "Pre-launch review" | LAUNCH_REVIEW | PRODUCTION_APPROVAL gate (never deploys) |
| `/jmw-finance-review` | "Review these finance files", "Do the treasurer review", "Check this AP package" | FINANCE_REVIEW | EXCEPTION_REVIEW gate |
| `/jmw-game-build` | "Keep building the game", "Get the vertical slice playable", "Work on the game overnight" | GAME_BUILD (OVERNIGHT_SAFE if unattended) | The next game state the user names, or the next HUMAN gate |

## Modifiers the PM listens for

- "read-only", "don't change anything", "just check" → force **REVIEW**.
- "overnight", "while I'm away", "don't wait for me" → **OVERNIGHT_SAFE** (never higher than L1).
- "deploy to staging" → **STAGING**, still only if the project policy allows it.
- "deploy to production", "go live", "send the emails", "post it" → L3. The PM confirms the exact action back to the user in the current task and does not infer it from earlier messages or DECISIONS.md.
