# JMW Artifacts

Evidence produced by JMW agents. Naming: `YYYY-MM-DD_<task_id>_<short-description>.<ext>`

| Folder | What goes here | In git? |
|---|---|---|
| `screenshots/` | PNG/JPG of the page under test | yes |
| `videos/` | Short recordings of the **test browser only** | no (too large; see `.gitignore`) |
| `qa-reports/` | QA, design, and launch reports (JMW-REVIEW format) | yes |
| `evidence/` | Packets for humans: owner review, launch, finance exceptions | yes |
| `logs/` | Command output (tests, builds) | no (can contain environment details) |

Never capture the desktop, unrelated tabs, inboxes, password managers, real customer data, secrets, or tokens. Full rules: `.jmw/standards/ORCHESTRATION-STANDARDS.md` section 7.
