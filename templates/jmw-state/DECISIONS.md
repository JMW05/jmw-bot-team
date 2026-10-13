# Decisions

Human decisions and authorizations, recorded so later sessions don't ask again. Only a human can make a decision. Agents record what the human said, in their words where possible.

Rules:
- `decided_by` must be a person (name or role), never an agent.
- `level: L3` approvals must use `expires: end-of-task`. They never become standing permission.
- `level: L4` is not allowed. Payments, DNS, destructive operations, secret changes, and paid resources are done by a human, not authorized for an agent.
- When a decision changes, set the old one to `status: superseded` and add a new one.

<!-- Copy this block for each decision. Newest at the bottom.

### D-001: Short title

```yaml
id: D-001
date: YYYY-MM-DD
decided_by: Jana (owner)
type: policy
level: none
decision: What was decided, in one or two sentences.
scope: What it applies to.
expires: none
status: active
```

type:    authorization | policy | scope | business | risk-acceptance
level:   none | L2 | L3   (the action level this authorizes, if any)
expires: none | YYYY-MM-DD | end-of-task
status:  active | superseded | expired
-->

No decisions recorded yet.
