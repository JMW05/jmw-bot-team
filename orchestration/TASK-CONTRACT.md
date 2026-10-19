# JMW Task Handoff Contract

When the Project Manager hands work to a specialist it sends a **TASK ENVELOPE**. The specialist answers with a **RESULT ENVELOPE**. Both are short YAML blocks. Do not replace them with long free-form prose; add a few lines of notes underneath only if the envelope cannot carry it.

## TASK ENVELOPE (PM → specialist)

```yaml
task_id: T-2026-10-13-03          # T-<date>-<sequence>, unique in RUN-LOG
run_key: R-2026-10-13-lavish-01   # from jmw-run.mjs start; used for preflight/spawn records
project: lavish
goal: Verify ISSUE-012 (quote form loses file on back button) is fixed on local preview
current_state: QA
mode: FIX
allowed_actions: [L0]             # levels and/or specific actions, e.g. "run npm run check"
prohibited_actions: [edit source, deploy, send email, change Access settings]
scope: quote form, upload step, 390px and 1440px
required_capabilities: [browser_qa]   # from docs/CAPABILITIES.md; [] when none. Checked by the PM first.
relevant_issue_ids: [ISSUE-012]
required_evidence: [screenshot before/after at 390px, test command output]
stop_conditions: [needs login, needs owner decision, action above allowed level]
```

## RESULT ENVELOPE (specialist → PM)

```yaml
task_id: T-2026-10-13-03
status: done                      # done | partial | failed | blocked | stopped-human-gate
changed: none                     # files changed, or none
tests:                            # only commands actually run, with the observed result
  - "npm run check: exit 0 (533 passed)"
evidence:                         # paths under .jmw/artifacts/ or URLs
  - .jmw/artifacts/screenshots/2026-10-13_T-2026-10-13-03_quote-390px.png
issues_created: []
issues_resolved: [ISSUE-012]      # only if THIS agent independently verified it
issues_remaining: []
recommended_next_action: Move ISSUE-012 to verified; continue with ISSUE-015
human_required: no                # yes | no
human_reason: none
state_transition_recommended: none   # e.g. "QA -> STAGING_READY" or none
```

## Rules

- A specialist may only do what `allowed_actions` permits and must stop on any `stop_conditions` item, returning `status: stopped-human-gate` or `blocked` with `human_reason` filled in.
- If a capability in `required_capabilities` turns out to be unavailable, the specialist stops with `status: blocked`, names the capability and its state, and does not substitute a weaker check and call it verified.
- `tests` lists only checks that were actually run, with what was observed. "Should pass" is not a result.
- A builder may report `issues_resolved` as **fixed-unverified** only. Resolution to `verified` requires a RESULT ENVELOPE from a different agent (or a person).
- Distinguish observed, tested, inferred, not checked, and blocked, as `CLAUDE.md` requires.
- No secrets in any envelope.
