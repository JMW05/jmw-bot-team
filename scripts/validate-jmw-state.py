#!/usr/bin/env python3
"""Validate a project's JMW state files (.jmw/STATUS.md, OPEN-ISSUES.md, ...).

Read-only (action level L0). Standard library only.

Usage:
    python scripts/validate-jmw-state.py <project-folder-or-.jmw-folder>

Exit code 0 = no errors (warnings may still be printed), 1 = errors found,
2 = could not run (folder or rules files missing).
"""
import re
import sys
from pathlib import Path

FENCE = re.compile(r"```yaml\n(.*?)```", re.S)
COMMENT = re.compile(r"<!--.*?-->", re.S)

ISSUE_FIELDS = [
    "id", "title", "priority", "type", "status", "owner", "environment",
    "evidence", "blocked_by", "requires_human_decision", "requires_credentials",
    "next_action", "verification_required", "verified_by", "verification_status",
]
ISSUE_ENUMS = {
    "priority": {"P0", "P1", "P2", "P3"},
    "type": {"bug", "design", "content", "qa-gap", "security", "performance",
             "accessibility", "finance-exception", "decision", "task"},
    "status": {"open", "in-progress", "fixed-unverified", "verified", "blocked",
               "needs-human", "wont-fix"},
    "environment": {"local", "staging", "production", "supplied-files", "n/a"},
    "requires_human_decision": {"yes", "no"},
    "requires_credentials": {"yes", "no"},
    "verification_status": {"not-verified", "passed", "failed", "not-verifiable"},
}
CLOSED = {"verified", "wont-fix"}
STATUS_FIELDS = ["project", "domain", "current_state", "target_state", "mode",
                 "environment", "branch", "last_updated", "last_run", "open_p0",
                 "open_p1", "human_gate"]
DECISION_FIELDS = ["id", "date", "decided_by", "type", "level", "decision",
                   "scope", "expires", "status"]
DECISION_ENUMS = {
    "type": {"authorization", "policy", "scope", "business", "risk-acceptance"},
    "level": {"none", "L2", "L3"},
    "status": {"active", "superseded", "expired"},
}
AGENT_NAMES = {"claude", "ai", "assistant", "jmw-project-manager", "site-builder",
               "site-architect", "design-director", "qa-tester", "launch-guard",
               "game-builder", "game-qa", "treasurer-reviewer", "ap-reviewer",
               "month-end-reviewer", "board-report-writer"}
SECRET_PATTERNS = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "private key"),
    (re.compile(r"\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}"), "Stripe-style key"),
    (re.compile(r"\bre_[A-Za-z0-9_]{20,}"), "Resend-style API key"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"), "GitHub token"),
    (re.compile(r"\bxox[abpr]-[A-Za-z0-9-]{10,}"), "Slack token"),
    (re.compile(r"(?i)\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{8,}"),
     "credential assignment"),
]


def parse_block(text):
    """Parse the small YAML subset used by JMW: `key: value` and `key:` + `- item` lists."""
    data, key = {}, None
    for raw in text.splitlines():
        line = raw.split(" #", 1)[0].rstrip() if not raw.lstrip().startswith("#") else ""
        if not line.strip():
            continue
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m and not raw.startswith(" "):
            key, val = m.group(1), m.group(2).strip()
            data[key] = val if val else []
        elif line.strip().startswith("- ") and key is not None:
            if not isinstance(data[key], list):
                data[key] = [data[key]] if data[key] else []
            data[key].append(line.strip()[2:].strip())
    return data


def blocks(path):
    """YAML blocks in a file, ignoring examples inside HTML comments."""
    if not path.exists():
        return []
    return [parse_block(b) for b in FENCE.findall(COMMENT.sub("", path.read_text(encoding="utf-8")))]


def as_list(v):
    if isinstance(v, list):
        return v
    return [] if v in ("", "none", None) else [v]


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"{where}: {msg}")


def find_rules(jmw):
    """Locate STATE-MACHINES.md and ORCHESTRATION-STANDARDS.md (synced copy first, then master repo)."""
    master = Path(__file__).resolve().parent.parent
    sm = next((p for p in [jmw / "workflows/STATE-MACHINES.md", master / "workflows/STATE-MACHINES.md"] if p.exists()), None)
    st = next((p for p in [jmw / "standards/ORCHESTRATION-STANDARDS.md", master / "standards/ORCHESTRATION-STANDARDS.md"] if p.exists()), None)
    return sm, st


def load_machines(path):
    machines = {}
    for b in blocks(path):
        if "machine" in b:
            machines[b["machine"]] = {"states": as_list(b.get("states")), "gates": set(as_list(b.get("human_gates")))}
    return machines


def apply_profile(machines, profile, rep):
    """Apply a PROJECT.md `## JMW Orchestration` block. Returns (domain, policy)."""
    if not profile.exists():
        return None, {}
    text = profile.read_text(encoding="utf-8")
    sec = re.search(r"^## JMW Orchestration\s*$(.*?)(?=^## |\Z)", text, re.S | re.M)
    if not sec:
        return None, {}
    bl = blocks_from_text(sec.group(1))
    if not bl:
        rep.err("PROJECT.md", "'## JMW Orchestration' section has no ```yaml block")
        return None, {}
    pol = bl[0]
    domain = pol.get("domain")
    if domain not in machines:
        rep.err("PROJECT.md", f"orchestration domain '{domain}' is not one of {sorted(machines)}")
        return None, pol
    m = machines[domain]
    for entry in as_list(pol.get("extra_states")):
        mm = re.match(r"^([A-Z][A-Z0-9_]*) after ([A-Z][A-Z0-9_]*)$", entry)
        if not mm:
            rep.err("PROJECT.md", f"extra_states entry '{entry}' must look like 'NEW_STATE after EXISTING_STATE'")
            continue
        new, after = mm.groups()
        if after not in m["states"]:
            rep.err("PROJECT.md", f"extra_states: '{after}' is not a {domain} state")
        elif new not in m["states"]:
            m["states"].insert(m["states"].index(after) + 1, new)
    for g in as_list(pol.get("extra_gates")):
        if g not in m["states"]:
            rep.err("PROJECT.md", f"extra_gates: '{g}' is not a state")
        m["gates"].add(g)
    for s in as_list(pol.get("skip_states")):
        if s in m["gates"]:
            rep.err("PROJECT.md", f"skip_states: '{s}' is a human gate and can never be skipped")
        elif s in m["states"]:
            m["states"].remove(s)
    return domain, pol


def blocks_from_text(text):
    return [parse_block(b) for b in FENCE.findall(COMMENT.sub("", text))]


def check_issues(jmw, rep, decision_ids):
    issues = []
    seen = set()
    for b in blocks(jmw / "OPEN-ISSUES.md"):
        iid = b.get("id", "?")
        where = f"OPEN-ISSUES {iid}"
        for f in ISSUE_FIELDS:
            if f not in b:
                rep.err(where, f"missing field '{f}'")
        if not re.match(r"^JMW-\d{3,}$", iid):
            rep.err(where, "id must look like JMW-001")
        if iid in seen:
            rep.err(where, "duplicate id")
        seen.add(iid)
        for f, allowed in ISSUE_ENUMS.items():
            if f in b and b[f] not in allowed:
                rep.err(where, f"{f} '{b[f]}' must be one of {sorted(allowed)}")
        st, vs = b.get("status"), b.get("verification_status")
        vby, owner = (b.get("verified_by") or "none").lower(), (b.get("owner") or "").lower()
        if st == "verified":
            if vs != "passed":
                rep.err(where, "status verified requires verification_status passed")
            if vby in ("none", ""):
                rep.err(where, "status verified requires verified_by")
            elif vby == owner:
                rep.err(where, "verified_by must be different from owner (no self-verification)")
        if vs == "passed" and vby in ("none", ""):
            rep.err(where, "verification_status passed requires verified_by")
        if b.get("requires_credentials") == "yes" and st not in {"blocked", "needs-human"} | CLOSED:
            rep.err(where, "requires_credentials yes: status must be blocked or needs-human")
        if b.get("requires_human_decision") == "yes" and st in ("in-progress", "fixed-unverified"):
            rep.warn(where, "being worked on while a human decision is still required")
        dec = b.get("decision", "none")
        if st == "wont-fix" and not re.match(r"^D-\d+$", dec):
            rep.err(where, "wont-fix requires decision: D-### (a human decision)")
        if re.match(r"^D-\d+$", dec) and dec not in decision_ids:
            rep.err(where, f"decision {dec} not found in DECISIONS.md")
        issues.append(b)
    return issues


def check_decisions(jmw, rep):
    ids = set()
    for b in blocks(jmw / "DECISIONS.md"):
        did = b.get("id", "?")
        where = f"DECISIONS {did}"
        for f in DECISION_FIELDS:
            if f not in b:
                rep.err(where, f"missing field '{f}'")
        if not re.match(r"^D-\d{3,}$", did):
            rep.err(where, "id must look like D-001")
        if did in ids:
            rep.err(where, "duplicate id")
        ids.add(did)
        if b.get("level") == "L4":
            rep.err(where, "L4 actions can never be authorized for an agent")
        for f, allowed in DECISION_ENUMS.items():
            if f in b and b[f] not in allowed:
                rep.err(where, f"{f} '{b[f]}' must be one of {sorted(allowed)}")
        who = (b.get("decided_by") or "").strip().lower()
        if not who or who.split()[0].strip("(),") in AGENT_NAMES:
            rep.err(where, "decided_by must be a human, not an agent")
        if b.get("level") == "L3" and b.get("status") == "active" and b.get("expires") != "end-of-task":
            rep.err(where, "L3 approvals must use expires: end-of-task (no standing L3 permission)")
    return ids


def check_status(jmw, rep, machines, profile_domain, modes, issues):
    bl = blocks(jmw / "STATUS.md")
    if not bl:
        rep.err("STATUS.md", "missing or has no ```yaml block")
        return
    s = bl[0]
    for f in STATUS_FIELDS:
        if f not in s:
            rep.err("STATUS.md", f"missing field '{f}'")
    domain, state = s.get("domain"), s.get("current_state")
    if domain == "unknown":
        if state != "NOT_STARTED":
            rep.err("STATUS.md", "domain unknown is only valid with current_state NOT_STARTED")
    elif domain not in machines:
        rep.err("STATUS.md", f"domain '{domain}' must be one of {sorted(machines)} or unknown")
    else:
        if profile_domain and profile_domain != domain:
            rep.err("STATUS.md", f"domain '{domain}' disagrees with PROJECT.md orchestration domain '{profile_domain}'")
        states = machines[domain]["states"]
        if state not in states:
            rep.err("STATUS.md", f"current_state '{state}' is not a {domain} state: {states}")
        tgt = s.get("target_state")
        if tgt not in ("none", None) and tgt not in states:
            rep.err("STATUS.md", f"target_state '{tgt}' is not a {domain} state")
        if state in machines[domain]["gates"] and s.get("human_gate") in ("none", ""):
            rep.warn("STATUS.md", f"{state} is a human gate but human_gate says none")
    if modes and s.get("mode") not in modes:
        rep.err("STATUS.md", f"mode '{s.get('mode')}' must be one of {modes}")
    if s.get("environment") not in ("local", "staging", "production", "supplied-files"):
        rep.err("STATUS.md", "environment must be local, staging, production, or supplied-files")
    for p in ("P0", "P1"):
        actual = sum(1 for i in issues if i.get("priority") == p and i.get("status") not in CLOSED)
        claimed = s.get(f"open_{p.lower()}")
        if str(actual) != str(claimed):
            rep.err("STATUS.md", f"open_{p.lower()} says {claimed} but OPEN-ISSUES.md has {actual} open {p}")


def check_runlog(jmw, rep):
    path = jmw / "RUN-LOG.md"
    if not path.exists():
        rep.err("RUN-LOG.md", "missing")
        return
    ids = re.findall(r"^## (RUN-\S+)", COMMENT.sub("", path.read_text(encoding="utf-8")), re.M)
    dupes = {i for i in ids if ids.count(i) > 1}
    for d in sorted(dupes):
        rep.err("RUN-LOG.md", f"duplicate run id {d}")


def check_secrets(jmw, rep):
    files = [jmw / n for n in ("STATUS.md", "DECISIONS.md", "OPEN-ISSUES.md", "HANDOFF.md", "RUN-LOG.md")]
    art = jmw / "artifacts"
    if art.exists():
        files += [p for p in art.rglob("*") if p.is_file() and p.suffix.lower() in (".md", ".txt", ".log", ".json")]
    for f in files:
        if not f.exists():
            continue
        for n, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for pat, label in SECRET_PATTERNS:
                if pat.search(line):
                    rep.err(f"{f.relative_to(jmw)}:{n}", f"looks like a {label}; remove it (never store secrets)")


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    root = Path(argv[1]).resolve()
    jmw = root if root.name == ".jmw" else root / ".jmw"
    if not jmw.is_dir():
        print(f"No .jmw folder at {jmw}. Run the JMW installer for this project first.")
        return 2
    sm, st = find_rules(jmw)
    if not sm or not st:
        print("Could not find STATE-MACHINES.md / ORCHESTRATION-STANDARDS.md (synced or master copy).")
        return 2
    rep = Report()
    machines = load_machines(sm)
    modes = next((as_list(b["modes"]) for b in blocks(st) if "modes" in b), [])
    for name in ("STATUS.md", "DECISIONS.md", "OPEN-ISSUES.md", "HANDOFF.md", "RUN-LOG.md"):
        if not (jmw / name).exists():
            rep.err(name, "missing (run the JMW installer; it creates missing state files)")
    profile_domain, _ = apply_profile(machines, jmw / "PROJECT.md", rep)
    decision_ids = check_decisions(jmw, rep)
    issues = check_issues(jmw, rep, decision_ids)
    check_status(jmw, rep, machines, profile_domain, modes, issues)
    check_runlog(jmw, rep)
    check_secrets(jmw, rep)

    for w in rep.warnings:
        print(f"WARNING  {w}")
    for e in rep.errors:
        print(f"ERROR    {e}")
    if rep.errors:
        print(f"\nJMW state: {len(rep.errors)} error(s), {len(rep.warnings)} warning(s) in {jmw}")
        return 1
    print(f"JMW state OK: {len(issues)} issue(s), {len(decision_ids)} decision(s), "
          f"{len(rep.warnings)} warning(s) in {jmw}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
