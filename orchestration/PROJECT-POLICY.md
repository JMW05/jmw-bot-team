# Project Policy Block

Each project profile (`projects/<slug>.md` in the master repo, installed as `.jmw/PROJECT.md`) may include the block below. It tells the Project Manager what this project allows. **If the block or a line is missing, the safest value applies** (shown in brackets).

Only a person may change these values. Edit them in the master repo profile, then re-run the installer.

```markdown
## JMW POLICY
- workflow: website                  <!-- website | game | finance  [ask if unclear] -->
- default_mode: FIX                  <!-- [REVIEW] -->
- default_branch: main               <!-- the production branch; agents never commit here  [main] -->
- staging_deploy: not-allowed        <!-- allowed | not-allowed  [not-allowed] -->
- staging_deploy_command: (none)     <!-- exact command, only used when staging_deploy is allowed -->
- staging_url: (none)
- draft_pr: not-allowed              <!-- allowed | not-allowed  [not-allowed] -->
- screen_recording: off              <!-- on | off  [off] -->
- owner: (name of the person who approves)
- state_overrides: none              <!-- see below -->
```

## State overrides

A project may **add** states, **rename** states for its own vocabulary, or **add** extra human gates. Write them as plain lines under `## JMW STATE OVERRIDES`, for example:

```markdown
## JMW STATE OVERRIDES
- add EMAIL_QA after QA: verify every customer email template in real inboxes (needs owner login)
- add human gate before DESIGN_REVIEW: owner approves scope
```

An override can **never** remove or skip a built-in human gate (`OWNER_REVIEW`, `PRODUCTION_APPROVAL`, `EXCEPTION_REVIEW`, `TREASURER_REVIEW`, `CLOSED`, release of a game) and can never raise a permission level.
