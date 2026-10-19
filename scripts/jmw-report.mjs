#!/usr/bin/env node
// Builds a Control Room Bot Ops report ("jmw-report/1") from one project's .jmw folder.
// DRY RUN ONLY: it prints or writes the JSON. It never sends anything, reads no credentials and
// makes no network call. Sending is a separate, human-gated step (BOT-OPS-JMW-HANDOFF.md).
//
//   node scripts/jmw-report.mjs --project-root <dir> [--run R-...] [--host <label>] [--out report.json]
//
// What it reads, all inside <dir>/.jmw:
//   PROJECT.md STATUS.md OPEN-ISSUES.md DECISIONS.md HANDOFF.md RUN-LOG.md  (sent whole, with sha256)
//   local/jmw-master.json -> capabilities_path     (capability state from scripts/test-jmw-environment.ps1;
//                                          or pass --capabilities <file>)
//   runs/<run_key>.json                     (the run ledger the PM writes; see the handoff)
//   gates/<gate_key>.json                   (decision packets raised by that run)
// The Control Room re-validates everything and recomputes every hash; this script only shapes it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]);
  return acc;
}, []));
if (!args['project-root']) {
  console.error('usage: node scripts/jmw-report.mjs --project-root <dir> [--run R-...] [--host <label>] [--out file]');
  process.exit(2);
}

const root = resolve(String(args['project-root']));
const jmw = join(root, '.jmw');
if (!existsSync(jmw)) { console.error('No .jmw folder in that project.'); process.exit(2); }

const sha256 = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex');
// Same canonical form as the Control Room (netlify/lib/bot-ops/canonical.mjs): keys sorted, no whitespace.
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));
const PACKET_FIELDS = ['gate_key', 'gate_kind', 'level', 'question', 'why_now', 'exact_action', 'options', 'recommended_option',
  'recommended_reason', 'verified_evidence', 'not_verified', 'risks', 'requested_at', 'expires_at'];
const iso = (t) => new Date(t).toISOString();

function packet(g) {
  const p = {};
  for (const k of PACKET_FIELDS) p[k] = g[k] ?? (['verified_evidence', 'not_verified', 'risks'].includes(k) ? [] : null);
  p.requested_at = iso(p.requested_at);
  p.expires_at = iso(p.expires_at);
  p.options = (p.options || []).map((o) => ({ key: o.key, label: o.label, consequence: o.consequence, authorizes: Boolean(o.authorizes) }));
  return p;
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const slugFromStatus = /^- project:\s*(\S+)/m.exec(existsSync(join(jmw, 'STATUS.md')) ? readFileSync(join(jmw, 'STATUS.md'), 'utf8') : '')?.[1];

const report = {
  schema: 'jmw-report/1',
  project: String(args.project ?? slugFromStatus ?? ''),
  // A short label, never the machine's user name or a path.
  host_label: String(args.host ?? hostname()).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40),
  sent_at: new Date().toISOString(),
  state_files: [],
};
if (!report.project) { console.error('Project slug not found: pass --project or set "- project:" in STATUS.md.'); process.exit(2); }

for (const name of ['PROJECT', 'STATUS', 'OPEN-ISSUES', 'DECISIONS', 'HANDOFF', 'RUN-LOG']) {
  const file = join(jmw, `${name}.md`);
  if (!existsSync(file)) continue;
  const content = readFileSync(file, 'utf8');
  report.state_files.push({ file: name, content, sha256: sha256(content), modified_at: statSync(file).mtime.toISOString() });
}

// Capability state lives in the master repo (config/capabilities.json), reached through the pointer
// the installer writes. It is never copied into the project.
const pointer = join(jmw, 'local', 'jmw-master.json');
const capFile = args.capabilities ? resolve(String(args.capabilities))
  : existsSync(pointer) ? readJson(pointer).capabilities_path : null;
if (capFile && existsSync(capFile)) {
  const cap = readJson(capFile);
  if (cap.schema_version === 1 && cap.generated_at) report.capabilities = {
    os: cap.host?.os ?? 'unknown',
    generated_at: iso(cap.generated_at),
    items: Object.entries(cap.capabilities ?? {}).map(([capability, v]) => ({
      capability, state: v.ready === true ? 'ready' : v.ready === false ? 'not_ready' : 'unknown', missing: v.missing ?? [] })),
  };
}

if (args.run) {
  const ledger = join(jmw, 'runs', `${args.run}.json`);
  if (!existsSync(ledger)) { console.error(`No run ledger at .jmw/runs/${args.run}.json`); process.exit(2); }
  const L = readJson(ledger);
  report.repo = L.repo ?? undefined;
  report.run = L.run;
  report.tasks = L.tasks ?? [];
  report.artifacts = L.artifacts ?? [];
  report.processes = L.processes ?? [];
  report.gate_consumptions = L.gate_consumptions ?? [];
  report.framework_feedback = L.framework_feedback ?? [];
  const gatesDir = join(jmw, 'gates');
  report.gates = (L.gates ?? []).map((key) => {
    const g = readJson(join(gatesDir, `${key}.json`));
    const p = packet(g);
    return { ...p, supersedes_gate_key: g.supersedes_gate_key ?? null, status: g.status ?? 'open', packet_hash: sha256(canonical(p)) };
  });
}

const out = JSON.stringify(report, null, 2);
if (args.out) { writeFileSync(String(args.out), out); console.log(`wrote ${args.out} (${report.state_files.length} state files${report.run ? `, run ${report.run.run_key}` : ''}). Nothing was sent.`); }
else process.stdout.write(`${out}\n`);
