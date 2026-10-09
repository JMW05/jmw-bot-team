# Start Here — JMW Bot Team v1

## 1. Create the Claude Code Project

Recommended project fields:

**Name**
JMW Bot Team

**Goal**
Build and maintain a reusable team of Claude Code agents that can plan, build, review, test, and prepare websites for launch, and can review treasurer/accounting workflows safely without making unauthorized financial changes.

**Context**
Use this repository as the source of truth. Read `CLAUDE.md` first. Website work must follow the website, design, QA, security, launch, responsive, and accessibility standards. Finance work must follow finance/security standards and remain review-first: analyze, recommend, and draft, but do not post journal entries, release payments, modify authoritative books, or represent a review as approval.

## 2. Put this folder in GitHub

Create a new private repository named:

`jmw-bot-team`

Then place the full contents of this folder in the repository root.

## 3. Open the repository in Claude Code

Claude Code automatically reads the root `CLAUDE.md`.

Project-level subagents live in:

`.claude/agents/`

Claude can delegate to them automatically when their descriptions match the task, or you can call them by name.

## 4. Verify the setup

Ask Claude:

`Read CLAUDE.md and list the JMW subagents available in .claude/agents. Do not modify anything.`

Expected agents:

- site-architect
- site-builder
- design-director
- qa-tester
- launch-guard
- treasurer-reviewer
- ap-reviewer
- month-end-reviewer
- board-report-writer

## 5. First safe website test

Copy an existing website repo into a separate working directory or open its existing feature branch, then ask:

`Use the design-director agent to review this site. Do not modify source code. Give me the score, P0/P1/P2/P3 issues, and the exact evidence behind each finding.`

Then:

`Use the qa-tester agent to independently verify the site. Do not trust previous fix claims. Do not deploy.`

## 6. First safe finance test

Place COPIES of exports/documents in a review folder. Never point v1 at a live payment system.

Ask:

`Use the treasurer-reviewer agent to review these files. Identify exceptions, missing support, coding questions, compliance flags, and decisions required. Do not post entries or change source files.`

## Human approval gates

These actions require explicit human authorization and should never happen merely because another bot recommended them:

- production deployment
- DNS changes
- secret/credential changes
- destructive database migrations
- releasing or scheduling payment
- posting journal entries
- changing QBO or another authoritative ledger
- marking compliance items complete when evidence is missing
