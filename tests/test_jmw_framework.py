"""Tests for the JMW orchestration framework.

Run from the repo root:
    python -m unittest discover -s tests -v

Installer tests need PowerShell 7 (`pwsh` on PATH, or set JMW_PWSH to its path).
They are skipped, with a printed reason, when PowerShell is not available.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VALIDATOR = REPO / "scripts" / "validate-jmw-state.py"
INSTALLER = REPO / "scripts" / "install-jmw-agents.ps1"
PWSH = os.environ.get("JMW_PWSH") or shutil.which("pwsh")
STATE_FILES = ["STATUS.md", "DECISIONS.md", "OPEN-ISSUES.md", "HANDOFF.md", "RUN-LOG.md"]


def validate(path):
    r = subprocess.run([sys.executable, str(VALIDATOR), str(path)], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def frontmatter(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    assert m, f"{path} has no frontmatter"
    try:
        import yaml
        return yaml.safe_load(m.group(1))
    except ImportError:
        return dict(re.findall(r"^(\w+): (.*)$", m.group(1), re.M))


def make_project(tmp, slug="lavish"):
    """Build a synced-project .jmw folder in Python (no PowerShell needed)."""
    jmw = Path(tmp) / ".jmw"
    (jmw / "workflows").mkdir(parents=True)
    (jmw / "standards").mkdir()
    shutil.copy(REPO / "workflows/STATE-MACHINES.md", jmw / "workflows")
    shutil.copy(REPO / "standards/ORCHESTRATION-STANDARDS.md", jmw / "standards")
    shutil.copy(REPO / f"projects/{slug}.md", jmw / "PROJECT.md")
    for name in STATE_FILES:
        t = (REPO / "templates/jmw-state" / name).read_text(encoding="utf-8")
        (jmw / name).write_text(t.replace("{{PROJECT_SLUG}}", slug).replace("{{INSTALL_DATE}}", "2026-10-13"), encoding="utf-8")
    return jmw


def issue(iid="JMW-001", **over):
    f = dict(id=iid, title="Quote form error clipped at 390px", priority="P1", type="bug",
             status="verified", owner="site-builder", environment="local",
             evidence=".jmw/artifacts/qa-reports/2026-10-13_T-03_qa.md", blocked_by="none",
             requires_human_decision="no", requires_credentials="no", next_action="none",
             verification_required="error text fully visible at 390px and 430px",
             verified_by="qa-tester", verification_status="passed", decision="none")
    f.update(over)
    body = "\n".join(f"{k}: {v}" for k, v in f.items())
    return f"\n### {iid}: {f['title']}\n\n```yaml\n{body}\n```\n"


def decision(did="D-001", **over):
    f = dict(id=did, date="2026-10-13", decided_by="Jana (owner)", type="risk-acceptance",
             level="none", decision="Accept 2XL surcharge copy as neutral for owner review.",
             scope="lavish owner review", expires="none", status="active")
    f.update(over)
    body = "\n".join(f"{k}: {v}" for k, v in f.items())
    return f"\n### {did}: test\n\n```yaml\n{body}\n```\n"


def set_status(jmw, **over):
    p = jmw / "STATUS.md"
    t = p.read_text(encoding="utf-8")
    for k, v in over.items():
        t = re.sub(rf"^{k}: .*$", f"{k}: {v}", t, count=1, flags=re.M)
    p.write_text(t, encoding="utf-8")


def append(jmw, name, text):
    with open(jmw / name, "a", encoding="utf-8") as f:
        f.write(text)


class TestRepoContents(unittest.TestCase):
    def test_agent_and_skill_frontmatter_parses(self):
        for p in sorted((REPO / ".claude/agents").glob("*.md")):
            fm = frontmatter(p)
            self.assertEqual(fm["name"], p.stem)
            self.assertTrue(fm["description"])
        skills = sorted((REPO / ".claude/skills").glob("*/SKILL.md"))
        self.assertEqual([p.parent.name for p in skills], sorted([
            "jmw-review", "jmw-fix-p1", "jmw-owner-ready", "jmw-launch-check",
            "jmw-finance-review", "jmw-game-build"]))
        for p in skills:
            fm = frontmatter(p)
            self.assertEqual(fm["name"], p.parent.name)
            self.assertIn("Use when", fm["description"])

    def test_all_twelve_agents_still_exist(self):
        names = {p.stem for p in (REPO / ".claude/agents").glob("*.md")}
        self.assertEqual(names, {
            "ap-reviewer", "board-report-writer", "design-director", "game-builder", "game-qa",
            "jmw-project-manager", "launch-guard", "month-end-reviewer", "qa-tester",
            "site-architect", "site-builder", "treasurer-reviewer"})

    def test_specialists_carry_task_contract(self):
        for p in (REPO / ".claude/agents").glob("*.md"):
            if p.stem == "jmw-project-manager":
                continue
            self.assertIn("JMW RESULT ENVELOPE", p.read_text(encoding="utf-8"), p.name)

    def test_project_manager_loop_has_twenty_steps_and_stops(self):
        t = (REPO / ".claude/agents/jmw-project-manager.md").read_text(encoding="utf-8")
        steps = re.findall(r"^(\d+)\. ", t.split("## Execution loop")[1].split("\n## ")[0], re.M)
        self.assertEqual(steps, [str(i) for i in range(1, 21)])
        self.assertIn("Do not ask the user for approval after ordinary safe steps", t)
        self.assertIn("Never bypass a human approval gate.", t)

    def test_state_machines_match_spec(self):
        sys.path.insert(0, str(REPO / "scripts"))
        import importlib.util
        spec = importlib.util.spec_from_file_location("v", VALIDATOR)
        v = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(v)
        m = v.load_machines(REPO / "workflows/STATE-MACHINES.md")
        self.assertEqual(m["website"]["states"], ["INTAKE", "DISCOVERY", "BUILDING", "DESIGN_REVIEW", "QA",
                         "STAGING_READY", "OWNER_REVIEW", "LAUNCH_REVIEW", "PRODUCTION_APPROVAL", "LIVE", "MAINTENANCE"])
        self.assertEqual(m["game"]["states"], ["CONCEPT", "VERTICAL_SLICE", "PLAYABLE_BUILD", "GAME_QA",
                         "VISUAL_REVIEW", "CONTENT_COMPLETE", "RELEASE_CANDIDATE"])
        self.assertEqual(m["finance"]["states"], ["OPEN_PERIOD", "DATA_GATHERING", "RECONCILIATION",
                         "EXCEPTION_REVIEW", "TREASURER_REVIEW", "CLOSE_READY", "CLOSED", "REPORTING"])
        self.assertIn("PRODUCTION_APPROVAL", m["website"]["gates"])
        self.assertIn("TREASURER_REVIEW", m["finance"]["gates"])

    def test_safety_rules_unchanged(self):
        t = (REPO / "CLAUDE.md").read_text(encoding="utf-8")
        for rule in ["release or schedule a payment;", "post a journal entry;",
                     "alter production DNS unless explicitly authorized;",
                     "treat AI review as human approval."]:
            self.assertIn(rule, t)


class TestValidator(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.jmw = make_project(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def assertFails(self, needle):
        code, out = validate(self.tmp)
        self.assertEqual(code, 1, out)
        self.assertIn(needle, out)

    def test_fresh_templates_pass(self):
        code, out = validate(self.tmp)
        self.assertEqual(code, 0, out)

    def test_realistic_lavish_state_passes(self):
        append(self.jmw, "DECISIONS.md", decision())
        append(self.jmw, "OPEN-ISSUES.md", issue())
        append(self.jmw, "OPEN-ISSUES.md", issue("JMW-002", priority="P1", status="needs-human", owner="human",
               type="decision", requires_human_decision="yes", verified_by="none",
               verification_status="not-verified", decision="none"))
        append(self.jmw, "OPEN-ISSUES.md", issue("JMW-003", priority="P2", status="wont-fix",
               verified_by="none", verification_status="not-verified", decision="D-001"))
        append(self.jmw, "RUN-LOG.md", "\n## RUN-2026-10-13-01\n- request: test\n")
        set_status(self.jmw, domain="website", current_state="STAGING_READY", target_state="OWNER_REVIEW",
                   mode="FIX", open_p1="1", human_gate="Approve staging deploy of abc1234?")
        code, out = validate(self.tmp)
        self.assertEqual(code, 0, out)

    def test_profile_extra_state_is_accepted(self):
        set_status(self.jmw, domain="website", current_state="LIVE_EMAIL_QA",
                   human_gate="Owner completes Access for real-inbox email QA")
        code, out = validate(self.tmp)
        self.assertEqual(code, 0, out)

    def test_self_verification_rejected(self):
        append(self.jmw, "OPEN-ISSUES.md", issue(verified_by="site-builder"))
        set_status(self.jmw, open_p1="0")
        self.assertFails("no self-verification")

    def test_verified_without_passing_rejected(self):
        append(self.jmw, "OPEN-ISSUES.md", issue(verification_status="not-verified"))
        self.assertFails("requires verification_status passed")

    def test_missing_issue_field_rejected(self):
        append(self.jmw, "OPEN-ISSUES.md", issue().replace("requires_credentials: no\n", ""))
        self.assertFails("missing field 'requires_credentials'")

    def test_credentials_issue_must_be_parked(self):
        append(self.jmw, "OPEN-ISSUES.md", issue(status="open", requires_credentials="yes",
               verified_by="none", verification_status="not-verified"))
        set_status(self.jmw, open_p1="1")
        self.assertFails("requires_credentials yes")

    def test_wont_fix_needs_human_decision(self):
        append(self.jmw, "OPEN-ISSUES.md", issue(status="wont-fix", verified_by="none",
               verification_status="not-verified"))
        self.assertFails("wont-fix requires decision")

    def test_open_counts_must_match(self):
        append(self.jmw, "OPEN-ISSUES.md", issue(status="open", verified_by="none",
               verification_status="not-verified"))
        self.assertFails("open_p1 says 0 but OPEN-ISSUES.md has 1")

    def test_l4_authorization_rejected(self):
        append(self.jmw, "DECISIONS.md", decision(type="authorization", level="L4"))
        self.assertFails("L4 actions can never be authorized")

    def test_standing_l3_rejected(self):
        append(self.jmw, "DECISIONS.md", decision(type="authorization", level="L3", expires="none"))
        self.assertFails("no standing L3 permission")

    def test_agent_cannot_decide(self):
        append(self.jmw, "DECISIONS.md", decision(decided_by="qa-tester"))
        self.assertFails("decided_by must be a human")

    def test_invalid_state_rejected(self):
        set_status(self.jmw, domain="website", current_state="SHIPPED_IT")
        self.assertFails("current_state 'SHIPPED_IT' is not a website state")

    def test_domain_must_match_profile(self):
        set_status(self.jmw, domain="game", current_state="CONCEPT")
        self.assertFails("disagrees with PROJECT.md")

    def test_profile_cannot_skip_gate(self):
        p = self.jmw / "PROJECT.md"
        p.write_text(p.read_text(encoding="utf-8").replace("skip_states: none", "skip_states:\n  - PRODUCTION_APPROVAL"), encoding="utf-8")
        self.assertFails("can never be skipped")

    def test_secret_in_state_rejected(self):
        append(self.jmw, "HANDOFF.md", "\nEMAIL_PROVIDER_API_KEY=re_AbCdEfGhIjKlMnOpQrStUvWx123\n")
        self.assertFails("looks like a")

    def test_template_examples_in_comments_are_ignored(self):
        t = (self.jmw / "OPEN-ISSUES.md").read_text(encoding="utf-8")
        self.assertIn("id: JMW-001", t)  # the commented example exists
        code, out = validate(self.tmp)
        self.assertIn("0 issue(s)", out)


@unittest.skipUnless(PWSH, "PowerShell 7 not found; set JMW_PWSH or put pwsh on PATH")
class TestInstaller(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "CLAUDE.md").write_text("PROJECT ROOT CLAUDE - must survive\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def install(self, slug="lavish"):
        r = subprocess.run([PWSH, "-NoLogo", "-NoProfile", "-File", str(INSTALLER),
                            "-TargetPath", str(self.tmp), "-ProjectSlug", slug],
                           capture_output=True, text=True, cwd=REPO)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r.stdout

    def test_fresh_install_creates_state_and_validates(self):
        out = self.install()
        jmw = self.tmp / ".jmw"
        for name in STATE_FILES:
            self.assertTrue((jmw / name).exists(), name)
        self.assertIn("project: lavish", (jmw / "STATUS.md").read_text(encoding="utf-8"))
        self.assertNotIn("{{", (jmw / "STATUS.md").read_text(encoding="utf-8"))
        for sub in ["screenshots", "videos", "qa-reports", "evidence", "logs"]:
            self.assertTrue((jmw / "artifacts" / sub / ".gitkeep").exists(), sub)
        self.assertTrue((jmw / "artifacts/.gitignore").exists())
        self.assertTrue((jmw / "handoffs/lavish-2026-10-09.md").exists())
        self.assertTrue((jmw / "standards/ORCHESTRATION-STANDARDS.md").exists())
        self.assertTrue((jmw / "workflows/STATE-MACHINES.md").exists())
        self.assertTrue((jmw / "templates/jmw-state/OPEN-ISSUES.md").exists())
        self.assertTrue((self.tmp / ".claude/skills/jmw-owner-ready/SKILL.md").exists())
        self.assertEqual((self.tmp / "CLAUDE.md").read_text(encoding="utf-8"), "PROJECT ROOT CLAUDE - must survive\n")
        self.assertIn("Project state files created", out)
        code, vout = validate(self.tmp)
        self.assertEqual(code, 0, vout)

    def test_reinstall_never_overwrites_project_state(self):
        self.install()
        jmw = self.tmp / ".jmw"
        custom = {n: f"MY OWN {n} CONTENT\n" for n in STATE_FILES}
        for n, c in custom.items():
            (jmw / n).write_text(c, encoding="utf-8")
        (jmw / "artifacts/evidence/keep-me.md").write_text("evidence", encoding="utf-8")
        (jmw / "artifacts/README.md").write_text("my readme", encoding="utf-8")
        (self.tmp / ".claude/skills/project-own-skill").mkdir(parents=True)
        (self.tmp / ".claude/skills/project-own-skill/SKILL.md").write_text("mine", encoding="utf-8")
        out = self.install()
        self.install()
        for n, c in custom.items():
            self.assertEqual((jmw / n).read_text(encoding="utf-8"), c, n)
        self.assertEqual((jmw / "artifacts/evidence/keep-me.md").read_text(encoding="utf-8"), "evidence")
        self.assertEqual((jmw / "artifacts/README.md").read_text(encoding="utf-8"), "my readme")
        self.assertEqual((self.tmp / ".claude/skills/project-own-skill/SKILL.md").read_text(encoding="utf-8"), "mine")
        self.assertIn("Existing project state kept unchanged", out)
        self.assertEqual((self.tmp / "CLAUDE.md").read_text(encoding="utf-8"), "PROJECT ROOT CLAUDE - must survive\n")
        # Re-sync must not nest folders (Copy-Item -Recurse quirk).
        self.assertFalse((self.tmp / ".claude/skills/jmw-owner-ready/jmw-owner-ready").exists())
        self.assertFalse((jmw / "templates/jmw-state/artifacts/artifacts").exists())

    def test_install_without_slug(self):
        r = subprocess.run([PWSH, "-NoLogo", "-NoProfile", "-File", str(INSTALLER), "-TargetPath", str(self.tmp)],
                           capture_output=True, text=True, cwd=REPO)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("project: unknown", (self.tmp / ".jmw/STATUS.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
