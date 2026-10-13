# JMW Orchestration: Plain-English Guide

## The idea in one paragraph
You tell the Project Manager a **goal** ("Get this owner-review ready"). It reads where the project stands, picks the most important safe next step, hands it to the right specialist, has a *different* specialist check the result, saves the evidence, updates the project's notes, and keeps going. It stops only when it needs **you**: a business decision, a login, an approval, or anything risky.

## The project's notebook (`.jmw/` in each project)
| File | What it is | Who writes it |
|---|---|---|
| `STATUS.md` | Where the project is right now, and what's waiting on you | Project Manager, every run |
| `OPEN-ISSUES.md` | Every problem found, its priority (P0–P3), and whether it's truly verified | Project Manager |
| `DECISIONS.md` | Your decisions and permissions, so you aren't asked twice | Project Manager records **your** words |
| `HANDOFF.md` | "Where we left off" for the next session | Project Manager, end of every run |
| `RUN-LOG.md` | Diary of every run. Never edited after the fact | Project Manager appends |
| `artifacts/` | Screenshots, QA reports, evidence packets | Specialists and Project Manager |

These files are **never overwritten** by re-installing or syncing.

## What the bots may do on their own
- **L0 Read** and **L1 Safe write** (reversible edits on a feature branch, tests, screenshots): yes, automatically.
- **L2 Controlled write** (e.g. staging deploy): only if the project profile or one of your decisions allows it.
- **L3** (production deploy, sending real email, accounting posting, publishing): only when you say yes for *that* task.
- **L4** (payments, DNS, destructive database work, secret changes, paid resources): **never**. The bot writes instructions and you do it.

## Things you can say
| Say | What happens |
|---|---|
| "Where are we?" | A summary of STATUS and open issues. No work done |
| "Review this" / `/jmw-review` | Design + QA review. Findings logged. No code changes |
| "Fix the P1s" / `/jmw-fix-p1` | Fixes the important issues on a branch, each one re-checked by QA |
| "Get this owner-review ready" / `/jmw-owner-ready` | Review → fix → verify → staging (if allowed) → owner packet. Stops for you |
| "Is it ready to launch?" / `/jmw-launch-check` | Launch Guard review. Stops at "approve production?" Never deploys |
| "Review the finance package" / `/jmw-finance-review` | Exception packet for the treasurer. Never posts or pays |
| "Keep building the game" / `/jmw-game-build` | Build → game QA → stops for your visual review |
| Add "overnight" | Same workflow, but nothing beyond L1, with a morning summary in HANDOFF |

## Giving standing permission
Say it plainly, e.g. *"For Lavish, you may deploy to staging whenever QA passes, until the end of the month."* The Project Manager records it in `DECISIONS.md` (`level: L2`, with an expiry). Production approvals can't be made standing. You approve each one.

## Checking the notebook is healthy
```
python scripts/validate-jmw-state.py C:\path\to\project
```
It reports format problems, self-verified issues, mismatched counts, invalid permissions, and anything that looks like a secret.
