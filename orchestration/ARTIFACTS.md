# JMW Artifact Standard

All evidence lives in the project under `.jmw/artifacts/`:

```
.jmw/artifacts/
  screenshots/   PNG screenshots (QA, design, game)
  videos/        screen recordings (git-ignored by default)
  qa-reports/    JMW-REVIEW reports, owner review packets
  evidence/      command output, test summaries, filled checklists
  logs/          raw logs (git-ignored by default)
```

**File names:** `YYYY-MM-DD_<task-id>_<short-what>.<ext>`, for example `2026-10-13_T-2026-10-13-03_quote-390px.png`. Every RESULT ENVELOPE lists the paths it created.

## Capturing

- Use the tools already installed; do not add new recording software. In order of preference:
  1. Playwright MCP / Chrome DevTools MCP screenshots of the page under test.
  2. Playwright's built-in video recording for a browser flow (records only that test browser).
  3. Godot headless output / in-engine capture for games.
  4. FFmpeg only for converting or trimming a recording that already exists.
- Record **only** the browser context or window under test. Never record the whole desktop, other tabs, email inboxes, password managers, dashboards with secrets, or anything unrelated.
- Never capture secrets, passwords, API keys, MFA codes, customer personal data beyond what the test needs, full bank or tax numbers. If one appears, delete the capture and record that it was deleted.
- Use test data, not real customer data, whenever possible.
- Screen recording is used only when the project policy says `screen_recording: on`, or the user asks for it in the current task.

## Owner review packet

When a run reaches a HUMAN gate such as OWNER_REVIEW, the PM saves a report using `templates/reports/JMW-REVIEW.md` (synced as `.jmw/templates/reports/JMW-REVIEW.md`) to `.jmw/artifacts/qa-reports/YYYY-MM-DD_owner-review.md`, with STATUS `READY FOR HUMAN APPROVAL` and links to the evidence.
