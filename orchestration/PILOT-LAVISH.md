# Pilot walk-through: "Get Lavish owner-review ready"

This is a **design check on paper**, using what `projects/lavish.md` and `projects/handoffs/lavish-2026-10-09.md` say about Lavish. Nothing was run against the Lavish repository or staging site, and nothing in it was changed. Facts below come from the handoff and are **unverified** until a real run checks them.

## Starting point (from the handoff, not verified)

- Workflow: website. Staging exists (`staging.lavishbyke.com`); production is not deployed.
- Last known suite: 533 tests, `npm run check` exit 0.
- Remaining real-inbox email QA: quote ready, status update, ready for pickup, shipped, manual message, one resend. These need the owner to get past Cloudflare Access in normal Chrome.
- Lavish's profile has no `## JMW POLICY` block yet, so the safe defaults apply: `staging_deploy: not-allowed`, `draft_pr: not-allowed`.

## What the loop would do

| # | Step | Level | Who | Outcome |
|---|---|---|---|---|
| 1–5 | Read PROJECT, STATUS, DECISIONS, OPEN-ISSUES, HANDOFF | L0 | PM | First install: HANDOFF.md is the Lavish snapshot; STATUS is blank |
| 6 | `git status`, branch, `git log -5`, ahead/behind; note whether the staging copy tweak was pushed | L0 | PM | Real state recorded in STATUS |
| 7–8 | Goal = OWNER_REVIEW. Current state inferred from evidence, likely QA | L0 | PM | STATUS: `current_state: QA`, `target_state: OWNER_REVIEW`, `mode: FIX` (policy does not allow staging deploys) |
| 9 | No issues logged yet → next state-machine step: independent QA | — | PM | |
| 10–11 | TASK ENVELOPE → qa-tester: `npm run check`, browser checks of the three apparel paths at 390/1440px, on staging where reachable without a login, otherwise local preview (read-only) | L0 | qa-tester | |
| 12–17 | RESULT: say 2 P1 + 3 P2 issues, screenshots saved | L1 (state/artifacts) | PM | Issues ISSUE-001..005 created; STATUS and RUN-LOG updated |
| 9–11 | Highest eligible: P1 ISSUE-001 → site-builder on a feature branch | L1 | site-builder | `fixed-unverified` |
| 13 | Independent verification → qa-tester on local preview | L0 | qa-tester | `verified` with evidence, or back to builder |
| 9 | Email QA issues: `requires_credentials: yes` → not eligible; marked `needs-human` | — | PM | Loop continues with other items |
| 9 | design-director review of changed screens | L0 | design-director | Findings logged as issues |
| … | Repeat until no eligible P0/P1 remains | | | |
| 18 | Fixes are on a feature branch and staging deploy is not allowed → STAGING_READY can only be met "on local preview, gap stated" | — | PM | |
| 20 | **Stop.** Owner review packet saved to `.jmw/artifacts/qa-reports/` | — | PM | |

## What you would be told at the stop

> Lavish is ready for your review on local preview, not staging. I need two things from you: (1) complete the Cloudflare Access login in normal Chrome so the six remaining email checks can run, and (2) decide whether agents may deploy feature-branch fixes to staging (add `staging_deploy: allowed` to the Lavish policy). Fixed and verified this run: ISSUE-001, ISSUE-002. Not verified: the six email templates in a real inbox.

## What this check showed about the design

- The loop never needed to ask permission between ordinary steps.
- It stopped for two legitimate reasons only: credentials (Access login) and a policy decision (staging deploys).
- Builder claims were never accepted as verification.
- Nothing touched production, DNS, secrets, Access settings, or the email allowlist.
