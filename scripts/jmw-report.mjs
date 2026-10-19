#!/usr/bin/env node
// Builds a Control Room Bot Ops report ("jmw-report/1") from one project's .jmw folder, and
// optionally sends it. The default is a DRY RUN: it prints or writes the JSON and sends nothing.
//
//   node scripts/jmw-report.mjs --project-root <dir> [--run R-...] [--host <label>] [--out report.json]
//   node scripts/jmw-report.mjs --project-root <dir> --run R-... --send [--url https://...] [--every-min N]
//
// What it reads, all inside <dir>/.jmw:
//   PROJECT.md STATUS.md OPEN-ISSUES.md DECISIONS.md HANDOFF.md RUN-LOG.md  (sent whole, with sha256)
//   local/jmw-master.json -> capabilities_path     (capability state from scripts/test-jmw-environment.ps1;
//                                          or pass --capabilities <file>)
//   runs/<run_key>.json                     (the run ledger written by scripts/jmw-run.mjs)
//   gates/<gate_key>.json                   (decision packets raised by that run)
// The Control Room re-validates everything and recomputes every hash; this script only shapes it.
//
// SEND (only with --send): URL from --url or env JMW_INGEST_URL (https; http only to 127.0.0.1 or
// localhost). The secret comes ONLY from env CONTROL_ROOM_INGEST_SECRET (header
// X-Control-Room-Ingest-Secret). It is never read from an argument or a file, and never printed,
// logged or written anywhere. Output is the status code, counts and warning/error codes only.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  canonicalJson, EXIT, flagInt, hasAbsolutePath, hostLabel, isMain, keyed, KEY_PATTERNS, looksSecret, packetOf, parseArgs,
  projectPaths, readStatus, refuse, runCli, sha256, usage,
} from './jmw-lib.mjs';

export const MAX_BODY_BYTES = 1024 * 1024;
export const SECRET_ENV = 'CONTROL_ROOM_INGEST_SECRET';
export const URL_ENV = 'JMW_INGEST_URL';
const SECRET_HEADER = 'X-Control-Room-Ingest-Secret';
const HOST_OS = ['Windows', 'macOS', 'Linux'];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function buildReport({ projectRoot, runKey = null, project = null, host = null, capabilities = null, now = new Date() }) {
  const paths = projectPaths(projectRoot);
  if (!existsSync(paths.jmw)) usage('No .jmw folder in that project.');
  const slug = String(project ?? readStatus(paths).project ?? '');
  if (!KEY_PATTERNS.project.test(slug)) usage('Project slug not found: pass --project or set "- project:" in .jmw/STATUS.md.');
  const report = { schema: 'jmw-report/1', project: slug, host_label: hostLabel(host ?? undefined), sent_at: new Date(now).toISOString(), state_files: [] };

  for (const name of ['PROJECT', 'STATUS', 'OPEN-ISSUES', 'DECISIONS', 'HANDOFF', 'RUN-LOG']) {
    const file = join(paths.jmw, `${name}.md`);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, 'utf8');
    report.state_files.push({ file: name, content, sha256: sha256(content), modified_at: statSync(file).mtime.toISOString() });
  }

  // Capability state lives in the master repo (config/capabilities.json), reached through the
  // pointer the installer writes. It is never copied into the project.
  const pointer = join(paths.jmw, 'local', 'jmw-master.json');
  let capFile = capabilities ? resolve(String(capabilities)) : null;
  if (!capFile && existsSync(pointer)) { try { capFile = readJson(pointer).capabilities_path ?? null; } catch { capFile = null; } }
  if (capFile && existsSync(capFile)) {
    const cap = readJson(capFile);
    if (cap.schema_version === 1 && cap.generated_at) {
      report.capabilities = {
        os: HOST_OS.includes(cap.host?.os) ? cap.host.os : 'unknown',
        generated_at: new Date(cap.generated_at).toISOString(),
        items: Object.entries(cap.capabilities ?? {}).filter(([k]) => KEY_PATTERNS.capability.test(k)).slice(0, 100).map(([capability, v]) => ({
          capability, state: v?.ready === true ? 'ready' : v?.ready === false ? 'not_ready' : 'unknown',
          missing: (v?.missing ?? []).filter((m) => /^[a-z0-9][a-z0-9_:.-]{0,63}$/.test(m)).slice(0, 20) })),
      };
    }
  }

  if (runKey) {
    const ledger = join(paths.runs, `${runKey}.json`);
    if (!existsSync(ledger)) usage(`No run ledger at .jmw/runs/${runKey}.json`);
    const L = readJson(ledger);
    if (L.repo) report.repo = L.repo;
    report.run = L.run;
    report.tasks = L.tasks ?? [];
    report.artifacts = L.artifacts ?? [];
    report.processes = L.processes ?? [];
    report.gate_consumptions = L.gate_consumptions ?? [];
    report.framework_feedback = L.framework_feedback ?? [];
    report.gates = (L.gates ?? []).map((key) => {
      const g = readJson(join(paths.gates, `${key}.json`));
      const p = packetOf(g);
      return { ...p, supersedes_gate_key: g.supersedes_gate_key ?? null, status: g.status ?? 'open', packet_hash: sha256(canonicalJson(p)) };
    });
  }
  return report;
}

/* ----------------------------------------------------------------- send */

export function ingestUrl(raw) {
  if (!raw) usage(`No ingest URL: pass --url or set ${URL_ENV}.`);
  let u;
  try { u = new URL(String(raw)); } catch { return usage('The ingest URL is not a valid URL.'); }
  if (u.username || u.password) refuse('The ingest URL must not contain credentials.');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) refuse('The ingest URL must be https (plain http is allowed only to 127.0.0.1 or localhost for testing).');
  if (u.search || u.hash) refuse('The ingest URL must not have a query string or fragment.');
  return u;
}

export function ingestSecret(env = process.env) {
  const s = env[SECRET_ENV];
  if (!s || String(s).length < 32) refuse(`Not sent: environment variable ${SECRET_ENV} is not set or is shorter than 32 characters. Set it in this shell only (never in a file in the repo or .jmw).`);
  return String(s);
}

// Checks the body before anything leaves the machine. Messages never include values.
export function checkBody(body, secret) {
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_BODY_BYTES) refuse(`Not sent: the report is ${bytes} bytes, over the 1 MiB limit.`);
  if (secret && body.includes(secret)) refuse('Not sent: the report contains the ingest secret itself.');
  if (looksSecret(body)) refuse('Not sent: the report contains something shaped like a credential. Find and remove it from the .jmw files or the ledger.');
  return bytes;
}

const code = (v) => String(v ?? '').replace(/[^a-z0-9_]/gi, '').slice(0, 60);

// One POST. Returns { status, ok, summary } where summary has only counts and codes.
export async function sendReport(report, { url, env = process.env, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const target = ingestUrl(url ?? env[URL_ENV]);
  const secret = ingestSecret(env);
  const body = JSON.stringify(report);
  const bytes = checkBody(body, secret);
  let res;
  try {
    res = await fetchImpl(target, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', [SECRET_HEADER]: secret }, body });
  } catch (e) {
    return { status: 0, ok: false, bytes, summary: `not delivered (${code(e?.cause?.code ?? e?.name ?? 'network_error')})` };
  }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  const counts = json?.counts && typeof json.counts === 'object'
    ? Object.entries(json.counts).filter(([, v]) => Number.isInteger(v) && v > 0).map(([k, v]) => `${code(k)}=${v}`) : [];
  const warnings = Array.isArray(json?.warnings) ? json.warnings.map((w) => code(w?.code)).filter(Boolean) : [];
  const errors = Array.isArray(json?.errors) ? json.errors.map((e) => code(e?.code)).filter(Boolean) : [];
  const parts = [`status ${res.status}`];
  if (json?.error) parts.push(`error ${code(json.error)}`);
  if (counts.length) parts.push(`counts ${counts.join(' ')}`);
  if (warnings.length) parts.push(`warnings ${[...new Set(warnings)].join(',')}`);
  if (errors.length) parts.push(`errors ${[...new Set(errors)].join(',')}`);
  return { status: res.status, ok: res.ok, bytes, counts, warnings, errors, summary: parts.join('; ') };
}

// Optional periodic send while the run is running (the Control Room sets the heartbeat on
// receipt). Ends after one final send once the run has ended, or at maxMs.
export async function sendLoop(build, { intervalMs, maxMs, send = sendReport, sendOptions = {}, log = console.log, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const t0 = Date.now();
  let last = null;
  for (;;) {
    const report = build();
    last = await send(report, sendOptions);
    log(`${new Date().toISOString()} ${last.summary}`);
    if (!report.run || report.run.status !== 'running' || Date.now() - t0 >= maxMs) return last;
    await wait(intervalMs);
  }
}

async function main(argv) {
  const { flags } = parseArgs(argv);
  for (const k of Object.keys(flags)) {
    if (/secret|token|password|api-?key|header/i.test(k)) refuse(`--${k} is not accepted. The ingest secret is read only from the environment variable ${SECRET_ENV}.`);
  }
  if (!flags['project-root']) usage('usage: node jmw-report.mjs --project-root <dir> [--run R-...] [--host <label>] [--out file] [--send [--url https://...] [--every-min N]]');
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run, { required: false });
  const build = () => buildReport({ projectRoot: flags['project-root'], runKey, project: flags.project === true ? null : flags.project ?? null,
    host: flags.host === true ? null : flags.host ?? null, capabilities: flags.capabilities === true ? null : flags.capabilities ?? null });
  const report = build();
  if (hasAbsolutePath(JSON.stringify({ ...report, state_files: [] }))) refuse('The report contains an absolute path outside the state files. Fix the ledger before reporting.');

  if (!flags.send) {
    const out = JSON.stringify(report, null, 2);
    if (flags.out) {
      writeFileSync(String(flags.out), out);
      console.log(`wrote ${flags.out} (${report.state_files.length} state files${report.run ? `, run ${report.run.run_key}` : ''}). Dry run: nothing was sent.`);
    } else process.stdout.write(`${out}\n`);
    return EXIT.OK;
  }
  const url = flags.url === true ? undefined : flags.url;
  const every = flagInt(flags['every-min'], 'every-min', { min: 1, max: 120 });
  if (every) {
    if (!runKey) usage('--every-min needs --run.');
    const maxH = flagInt(flags['max-hours'], 'max-hours', { min: 1, max: 24 }) ?? 12;
    const last = await sendLoop(build, { intervalMs: every * 60000, maxMs: maxH * 3600000, sendOptions: { url } });
    return last.ok ? EXIT.OK : EXIT.ERROR;
  }
  const r = await sendReport(report, { url });
  console.log(r.summary);
  return r.ok ? EXIT.OK : EXIT.ERROR;
}

if (isMain(import.meta.url)) runCli(main);
