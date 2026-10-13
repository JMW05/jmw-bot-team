# Decisions

<!--
Only a HUMAN makes a decision. Agents may RECORD a decision only when a person
stated it, and must say who and when. An AI recommendation is not a decision.

A decision recorded here never pre-approves an L3 action (production deploy,
email send, accounting posting, etc.) in a later session. L3 still needs the
owner's explicit approval in the current task. L4 actions are never autonomous.

Add new decisions at the bottom. Do not edit or delete old ones; supersede them.
-->

## Template (copy below this line)

### D-000 — (short title)
- date: YYYY-MM-DD
- decided_by: (person's name)
- source: (where they said it: chat, email, meeting, etc.)
- decision: (what was decided, in one or two sentences)
- scope: (what it applies to)
- supersedes: (D-### or none)
- status: active           <!-- active | superseded | expired -->
