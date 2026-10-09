# JMW Bot Team

A reusable Claude Code operating system for two kinds of work:

1. **JMW Web Studio** — plan, build, review, test, and prepare websites for launch.
2. **JMW Finance Ops** — review treasurer/AP/month-end work and prepare clear reports without allowing AI to post accounting entries or release payments.

## Core rule

The bots may inspect, analyze, draft, test, and recommend. They must not deploy production, release payments, post journal entries, alter authoritative accounting records, or expose secrets unless an authorized human explicitly directs the allowed action.

## How this repo works

- `CLAUDE.md` — master project instructions Claude Code reads automatically.
- `.claude/agents/` — reusable Claude Code subagents.
- `standards/` — rules the agents must follow.
- `checklists/` — repeatable QA and finance review procedures.
- `templates/` — starting briefs and review formats.

## First commands to try

In Claude Code, from this repository:

- `Use the site-architect agent to turn templates/website-project/PROJECT-BRIEF.md into a build specification.`
- `Use the design-director agent to review this project against standards/DESIGN-STANDARDS.md.`
- `Use the qa-tester agent to verify the current site without assuming prior fixes worked.`
- `Use the treasurer-reviewer agent to review a finance package placed in templates/finance-review/input/ and report exceptions only.`

See `START-HERE.md` for setup.
