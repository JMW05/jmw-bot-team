# Orchestration Standards

How the JMW Project Manager (PM) decides what it may do on its own, when it must stop, and how it hands work to specialists.

**Precedence:** `CLAUDE.md` safety rules, `SECURITY-RULES.md`, `FINANCE-STANDARDS.md`, and the project's own rules override everything here. This file can only add limits, never remove one.

---

## 1. Action levels

Every action the PM or a specialist takes has a level. If an action could fit two levels, use the higher one.

| Level | Name | Examples | When allowed |
|---|---|---|---|
| **L0** | READ | inspect files, git status/log, run tests/lint/build that write nothing outside build output, analyze, report | Always |
| **L1** | SAFE WRITE | reversible code/doc edits on a non-production feature branch, adding tests, local commits, screenshots/artifacts, updating `.jmw/` state files | Automatically, when inside the approved scope and mode |
| **L2** | CONTROLLED WRITE | staging deployment, creating drafts (email draft, PR draft, report draft in an external tool), other reversible external changes | Only when the project policy (`PROJECT.md` → `l2_allowed`) or an active decision in `DECISIONS.md` explicitly allows that specific action, AND the mode allows L2 |
| **L3** | HUMAN APPROVAL REQUIRED | production deployment, sending email to real people, QBO/accounting posting, permission/access changes, meaningful database writes, external publication, pushing to a shared default branch, merging a PR | Only after a human approves that specific action in the current task. Approval does not carry over to later tasks |
| **L4** | NEVER AUTONOMOUS | payments, DNS migration/change, destructive database operations, secret rotation/change, paid resource creation, destructive bulk operations (mass delete, force-push over others' work, history rewrite of shared branches) | Never performed by an agent. The PM prepares instructions; a human does it |

Notes:
- Writing `.jmw/` state files and `.jmw/artifacts/` is L1 in **every** mode, including REVIEW.
- Pushing a feature branch to the project's own remote is L1 when the project already uses that remote for feature branches; otherwise treat it as L2.
- "Reversible" means a known, tested way back exists (git revert, redeploy the previous staging version). If you can't name the way back, it isn't L1/L2.
- A level-L3 approval must be recorded in `DECISIONS.md` with `level: L3` and `expires: end-of-task`.
- Nothing can authorize L4 autonomy. A `DECISIONS.md` entry with `level: L4` is invalid.

---

## 2. Modes

A mode sets the **ceiling** on action levels for a run. The project policy and the task envelope can only narrow it.

| Mode | Purpose | Max level | Default target | Typical agents |
|---|---|---|---|---|
| `REVIEW` | Find and document problems. No source changes | L0 (+ `.jmw/` writes) | report + issues | design-director, qa-tester, launch-guard |
| `FIX` | Fix approved issues (default: open P0/P1) on a feature branch | L1 | issues verified | site-builder / game-builder → qa-tester / game-qa |
| `STAGING` | Fix + deploy to staging + verify on staging | L2 (only allowed L2 actions) | `STAGING_READY` / `OWNER_REVIEW` | builders, qa-tester |
| `LAUNCH_REVIEW` | Final readiness review. No source changes | L0 (+ `.jmw/` writes) | `PRODUCTION_APPROVAL` gate | launch-guard, qa-tester |
| `OVERNIGHT_SAFE` | Unattended work while the human is away | L1, never L2 even if allowed | as far as L1 allows | any non-finance builder/QA pair |
| `FINANCE_REVIEW` | Review supplied finance copies. Source files read-only | L0 (+ `.jmw/` writes) | `TREASURER_REVIEW` gate | ap-reviewer, treasurer-reviewer, month-end-reviewer, board-report-writer |
| `GAME_BUILD` | Build/verify game features in the game repo | L1 | `VISUAL_REVIEW` gate | game-builder → game-qa |

`OVERNIGHT_SAFE` extras: no external network actions except reading, no package installs that change lockfiles unless the fix requires it, and the run ends with a morning summary in `HANDOFF.md`.

```yaml
modes:
  - REVIEW
  - FIX
  - STAGING
  - LAUNCH_REVIEW
  - OVERNIGHT_SAFE
  - FINANCE_REVIEW
  - GAME_BUILD
```

---

## 3. Continue vs. stop

**Default is CONTINUE.** The PM does not ask permission for ordinary L0/L1 steps that are inside scope.

**Stop (a legitimate human gate)** only when the next needed action involves:
1. a human business/policy decision (prices, policies, copy direction, scope changes);
2. credentials, login, MFA, or Cloudflare-Access-style auth the agent can't complete safely;
3. production approval;
4. accounting posting;
5. payment;
6. a destructive operation;
7. unresolved material ambiguity (two reasonable readings lead to different results that matter);
8. an action outside the authorized mode or scope.

**Park, don't stall.** If one issue hits a stop condition, mark it `needs-human` (with the reason) and move on to the next eligible item. Stop the whole run only when no eligible safe action remains, or the target state itself is behind a gate.

**Checkpoint stops** (not gates, but the run ends and says so):
- run budget reached: 20 specialist dispatches per run unless the user sets another number;
- the same issue failed verification 3 times: mark it `blocked` and stop retrying it;
- a test/build that passed before now fails for reasons outside scope: record it, don't widen scope to fix it.

---

## 4. Task envelope (PM → specialist)

The PM sends this block, plus only the context the specialist needs. No long prose handoffs when this is enough.

```text
JMW TASK ENVELOPE
task_id: T-2026-10-13-03
project: lavish
goal: Fix JMW-004 (quote form error state clipped at 390px)
current_state: BUILDING
mode: FIX
allowed_actions:
  - L0 any
  - L1 edit files under src/ and tests/ on branch jmw/fix-p1
prohibited_actions:
  - deploy anywhere
  - edit .env*, wrangler secrets, DNS, or CI config
  - change prices, policy, or approved copy
scope: src/components/QuoteForm*, tests/quote-form*
relevant_issue_ids: JMW-004
required_evidence:
  - npm run check output (exit code)
  - list of files changed
stop_conditions:
  - fix needs a change outside scope
  - fix needs a business decision
  - credentials required
```

## 5. Result envelope (specialist → PM)

Specialists put their normal detailed report first, then end with this block.

```text
JMW RESULT ENVELOPE
task_id: T-2026-10-13-03
status: done            # done | partial | failed | blocked | needs-human
changed: src/components/QuoteForm.tsx, tests/quote-form.test.ts
tests: npm run check -> exit 0 (533 passed)
evidence: .jmw/artifacts/logs/2026-10-13_T-03_npm-check.txt
issues_created: none
issues_resolved: none   # builders never resolve; they report fixed-unverified
issues_remaining: JMW-004 fixed-unverified
recommended_next_action: qa-tester verify JMW-004 at 390px and 430px
human_required: no
human_reason: none
state_transition_recommended: none
```

Rules:
- Only report tests you actually ran, with the real result.
- A specialist may never mark its own work `verified`. Builders report `fixed-unverified`.
- `state_transition_recommended` is a recommendation. The PM decides, and human gates still apply.

---

## 6. Independent verification

| Work done by | Verified by | Notes |
|---|---|---|
| site-builder | qa-tester (behavior), design-director (visual P0/P1) | on the same environment the claim is about |
| game-builder | game-qa | runtime unavailable → `not-verifiable`, never `passed` |
| design-director finding fixed | design-director re-check, or qa-tester for objective items | |
| ap / treasurer / month-end reviewer | **a human** | AI review is never approval |
| launch-guard | a human (production approval) | |

An issue reaches `verified` only when `verified_by` is a different agent or person from `owner`, and `verification_status: passed`.
Local verification is not staging verification. Staging is not production.

---

## 7. Artifacts

```text
.jmw/artifacts/
  screenshots/   PNG/JPG evidence
  videos/        short screen recordings of the test browser only (git-ignored by default)
  qa-reports/    JMW-REVIEW reports from qa-tester / design-director / launch-guard
  evidence/      packets for humans (owner-review packet, launch packet, finance exception packet)
  logs/          command output (test/build logs; git-ignored by default)
```

**File names:** `YYYY-MM-DD_<task_id>_<short-description>.<ext>`
e.g. `2026-10-13_T-03_quote-form-390px.png`

**Recording and screenshots:**
- Record only the automation browser the test opened (for example Playwright `recordVideo`, or a Playwright/Chrome DevTools MCP screenshot of the target page). Never record the desktop, the whole screen, or the user's personal browser profile.
- Never capture unrelated tabs, email inboxes, password managers, dashboards with real customer data, secrets, or tokens. Use test data. If a page under test shows real personal data, don't capture it. Describe it in text instead.
- FFmpeg/ImageMagick may be used to trim, compress, or annotate artifacts that already exist. Not for capturing.
- Before saving logs, remove anything that looks like a secret. Never save `.env` contents or auth headers.
- Every `evidence` field in an issue or result envelope points to an artifact path or quotes a short, observed result.

---

## 8. Natural-language routing

The PM (and the JMW skills) map plain requests to workflows. Close variations count.

| You say | Workflow | Mode |
|---|---|---|
| "Review this", "What's wrong with this site?" | `jmw-review` | REVIEW |
| "Fix the P1s", "Fix the important issues" | `jmw-fix-p1` | FIX |
| "Get this owner-review ready", "Get it ready for Ke to look at" | `jmw-owner-ready` | STAGING if policy allows staging deploy, else FIX |
| "Is it ready to launch?", "Run the launch check" | `jmw-launch-check` | LAUNCH_REVIEW |
| "Review the finance package", "Month-end review" | `jmw-finance-review` | FINANCE_REVIEW |
| "Keep building the game", "Work on the next game feature" | `jmw-game-build` | GAME_BUILD |
| "Work on this overnight", "Do what you safely can while I'm away" | the matching workflow | OVERNIGHT_SAFE |
| "Where are we?", "Status?" | read `STATUS.md` + `OPEN-ISSUES.md`, summarize, no work | REVIEW |
