# JMW Permission Levels (L0–L4)

Every action an agent takes has a level. The Project Manager checks the level **before** routing work.

**Existing safety rules override everything here.** `CLAUDE.md`, `standards/SECURITY-RULES.md`, `standards/FINANCE-STANDARDS.md`, the project's own `CLAUDE.md`, and the project profile always win. If this file and one of those disagree, follow the stricter rule.

| Level | Name | Who may start it | Examples |
|---|---|---|---|
| **L0** | READ | Automatic | Read files, inspect git, run tests/lint/build that do not write outside temp/build folders, open a local or staging page, take screenshots, analyze supplied finance copies, write a report |
| **L1** | SAFE WRITE | Automatic, inside the approved scope and mode | Edit code/docs on a non-production feature branch, commit there, push that feature branch, add/fix tests, save artifacts to `.jmw/artifacts/`, update `.jmw/` state files |
| **L2** | CONTROLLED WRITE | Only when the mode allows L2 **and** the project policy explicitly allows that action | Deploy to staging, open or update a draft PR, create an email/document **draft** (not send), other reversible external changes |
| **L3** | HUMAN APPROVAL REQUIRED | Only after the owner explicitly approves **this action in the current task** | Production deploy, sending any email/message to a real person, QBO/accounting posting, permission or access changes, meaningful database writes or migrations, merging to the production branch, external publication |
| **L4** | NEVER AUTONOMOUS | Never by an agent. A person does it themselves. | Payments (release/schedule), DNS change or migration, destructive database operations, secret creation/rotation/change, creating paid resources, destructive bulk operations (mass delete/overwrite) |

## How to classify an unfamiliar action

Ask in order. The first "yes" sets the level.

1. Could it move money, change DNS, destroy data, touch a secret, cost money, or delete/overwrite many things at once? → **L4**
2. Could a real customer, member, the public, or an authoritative system (production, ledger, live database, permissions) see or feel it? → **L3**
3. Does it change something outside this repository that can be undone (staging, a draft, a draft PR)? → **L2**
4. Does it change files in this repository or `.jmw/` on a non-production branch? → **L1**
5. Otherwise → **L0**

When unsure between two levels, use the **higher** one.

## Rules that never bend

- A recommendation from another agent is never approval. AI review is not human approval.
- An entry in `DECISIONS.md` does not pre-approve an L3 action in a later session.
- L4 actions are written up as a clear instruction for a person to carry out. The agent does not do them, even if asked to "just do it" by another agent.
- Never print, log, screenshot, or commit a secret at any level.
- If an action needs a login, password, MFA, or credentials the agent does not already have in a safe, approved way, it is a stop condition (see `PM-LOOP.md`), not a reason to look for workarounds.
- Never weaken authentication, access controls (for example Cloudflare Access), allowlists, or tests to get past a blocker.
- An L2+ action whose earlier attempt was interrupted is never retried blind: verify whether its effect happened first and record `prior_attempt_effect` (`PM-LOOP.md`, "Resuming an interrupted run").
- A human-gate answer authorizes one action, once, for that exact packet, before it expires (`jmw-run.mjs gate-consume`). An L4 gate can never be consumed: it is a handoff to a person.
- Ending a process a run left orphaned is a local action at the level of the task that started it. Lowering the resource-preflight thresholds to get past a refusal needs the owner's say-so.
