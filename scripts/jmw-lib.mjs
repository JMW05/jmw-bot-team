// Shared helpers for the JMW Bot Ops scripts (jmw-run.mjs, jmw-preflight.mjs, jmw-report.mjs).
// Node 22, no dependencies, no network. Installed into a project as .jmw/scripts/.
//
// The vocabularies, key patterns, secret shapes and the packet hash mirror the Control Room
// (JMW05/byjmw-control-room netlify/lib/bot-ops/{vocab,validate,canonical}.mjs).
// tests/node/control-room-contract.test.mjs checks them against that repo when it is present.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------ vocabulary */

export const LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4']);
export const BOT_LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3']);
export const levelRank = (l) => LEVELS.indexOf(l);
export const WORKFLOWS = Object.freeze(['website', 'app', 'game', 'finance', 'nonprofit', 'civic', 'campaign',
  'creative', 'media', 'automation', 'data', 'infrastructure', 'other']);
export const RUN_STATUSES = Object.freeze(['running', 'succeeded', 'stopped_human_gate', 'stopped_no_eligible_work',
  'budget_exhausted', 'failed', 'blocked', 'cancelled', 'interrupted']);
export const TASK_STATUSES = Object.freeze(['queued', 'running', 'done', 'partial', 'failed', 'blocked',
  'stopped_human_gate', 'interrupted', 'skipped']);
export const GATE_KINDS = Object.freeze(['state_gate', 'l3_approval', 'l4_handoff', 'credentials_needed',
  'policy_decision', 'material_ambiguity', 'visual_review', 'financial_review']);
export const L4_OPTION_KEYS = Object.freeze(['done_by_human', 'not_doing', 'deferred']);
export const GATE_MAX_DAYS = 30;
export const ARTIFACT_KINDS = Object.freeze(['screenshot', 'video', 'log', 'report', 'evidence', 'packet', 'brief',
  'audio', 'document', 'test_result', 'other']);
export const LOCATION_KINDS = Object.freeze(['repo', 'local_only', 'url']);
export const PROCESS_KINDS = Object.freeze(['godot', 'ffmpeg', 'imagemagick', 'playwright', 'browser',
  'browser_recorder', 'dev_server', 'test_runner', 'node', 'python', 'other']);
export const PROCESS_STATUSES = Object.freeze(['running', 'exited_ok', 'exited_error', 'killed', 'orphaned', 'unknown']);
export const FEEDBACK_COMPONENTS = Object.freeze(['agent', 'skill', 'orchestration', 'pm_loop', 'installer',
  'capability_checker', 'jmw_report', 'state_files', 'process_supervision', 'other']);
export const FEEDBACK_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low']);
export const KEY_PATTERNS = Object.freeze({
  project: /^[a-z0-9][a-z0-9-]{0,62}$/,
  bot: /^[a-z][a-z0-9-]{1,62}$/,
  run: /^R-[A-Za-z0-9][A-Za-z0-9._-]{2,62}$/,
  task: /^T-[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/,
  issue: /^[A-Z][A-Z0-9]*-[0-9]{1,6}$/,
  gate: /^G-[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/,
  feedback: /^FF-[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/,
  mode: /^[A-Z][A-Z0-9_]{1,31}$/,
  capability: /^[a-z][a-z0-9_]{0,63}$/,
  optionKey: /^[a-z][a-z0-9_]{0,40}$/,
  sha: /^[0-9a-f]{7,40}$/,
  sha256: /^[0-9a-f]{64}$/,
});

// Highest level each mode allows (orchestration/MODES.md). A run may go lower, never higher,
// except an explicit --max-level L3, which still needs a consumed gate for every L3 action.
export const MODE_MAX_LEVEL = Object.freeze({ REVIEW: 'L0', FIX: 'L1', STAGING: 'L2', LAUNCH_REVIEW: 'L0',
  OVERNIGHT_SAFE: 'L1', FINANCE_REVIEW: 'L0', GAME_BUILD: 'L1' });

// Process kinds that are heavy on RAM, disk or CPU. They need a resource preflight first.
export const HEAVY_KINDS = Object.freeze(['godot', 'ffmpeg', 'imagemagick', 'playwright', 'browser', 'browser_recorder', 'test_runner']);

/* ---------------------------------------------------------------- errors */

// Exit codes shared by every script (documented in BOT-OPS-JMW-HANDOFF.md).
export const EXIT = Object.freeze({ OK: 0, ERROR: 1, USAGE: 2, PREFLIGHT_BLOCKED: 3, CRASH_LOOP: 4, REFUSED: 5, TIMEOUT: 124 });

export class JmwError extends Error {
  constructor(message, exitCode = EXIT.USAGE) { super(message); this.exitCode = exitCode; }
}
export const refuse = (message) => { throw new JmwError(message, EXIT.REFUSED); };
export const usage = (message) => { throw new JmwError(message, EXIT.USAGE); };

// Runs a CLI entry point: prints JmwError messages (which never contain secret values) and exits.
export async function runCli(main) {
  try {
    const code = await main(process.argv.slice(2));
    process.exitCode = code ?? 0;
  } catch (e) {
    if (e instanceof JmwError) { console.error(e.message); process.exitCode = e.exitCode; }
    else { console.error(`Unexpected error: ${e?.code ?? e?.name ?? 'error'}`); process.exitCode = EXIT.ERROR; }
  }
}

/* ------------------------------------------------------------------ args */

// --key value, --key=value, --flag; everything after a bare "--" is returned as `rest`.
export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 2) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[a.slice(2)] = true;
    else { flags[a.slice(2)] = next; i += 1; }
  }
  return { flags, rest };
}

export const flagList = (v) => (v === undefined || v === true ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));
export function flagBool(v, name) {
  if (v === undefined) return null;
  if (v === true) return true;
  const s = String(v).toLowerCase();
  if (['yes', 'true', '1'].includes(s)) return true;
  if (['no', 'false', '0'].includes(s)) return false;
  return usage(`--${name} must be yes or no.`);
}
export function flagInt(v, name, { min = 0, max = 2 ** 31 - 1 } = {}) {
  if (v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) usage(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/* ---------------------------------------------------------- safe values */

// Copied from the Control Room validator: value shapes that are credentials in any field.
const SECRET_SHAPES = [
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\b(sb_secret|sbp)_[A-Za-z0-9_-]{16,}/,
  /\bre_[A-Za-z0-9]{16,}/,
  /\bnfp_[A-Za-z0-9]{16,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{6,}/i,
];
export const looksSecret = (text) => SECRET_SHAPES.some((re) => re.test(String(text)));
export const ABSOLUTE_PATH = /(^|[\s"'(])([A-Za-z]:[\\/]|\\\\|\/(home|Users|root|mnt|var|tmp|etc|opt|private)\/|~[\\/])/;
export const hasAbsolutePath = (text) => ABSOLUTE_PATH.test(String(text));

// A free-text field that will reach the Control Room. Refused (never repaired, never echoed) when
// it is too long, looks like a credential, or contains an absolute path.
export function safeText(name, value, { max = 300, required = false } = {}) {
  if (value === undefined || value === null || value === true || String(value).trim() === '') {
    if (required) usage(`${name} is required.`);
    return null;
  }
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (s.length > max) usage(`${name} is longer than ${max} characters.`);
  if (looksSecret(s)) refuse(`${name} looks like it contains a credential. Nothing was written. Remove it and try again.`);
  if (hasAbsolutePath(s)) refuse(`${name} contains an absolute file path. Use a path relative to the project. Nothing was written.`);
  return s;
}

export function keyed(name, value, pattern, { required = true } = {}) {
  if (value === undefined || value === null || value === true || value === '') {
    if (required) usage(`--${name} is required.`);
    return null;
  }
  const s = String(value).trim();
  if (!pattern.test(s)) usage(`--${name} has an invalid format.`);
  return s;
}

export function oneOf(name, value, list, { required = true } = {}) {
  if (value === undefined || value === null || value === true || value === '') {
    if (required) usage(`--${name} is required (one of: ${list.join(', ')}).`);
    return null;
  }
  const s = String(value).trim();
  if (!list.includes(s)) usage(`--${name} must be one of: ${list.join(', ')}.`);
  return s;
}

// A process label is a few safe words, never a command line: no slashes, quotes, flags,
// assignments, URLs or user@host (same rule as the Control Room).
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 .,:()+_-]{0,79}$/;
export function safeLabel(value) {
  const s = String(value ?? '').trim();
  if (!s || s === 'true') usage('--label is required: a few words such as "Godot headless combat lab".');
  if (!SAFE_LABEL.test(s) || /--|=/.test(s) || looksSecret(s)) {
    refuse('--label must be a few plain words (letters, digits, spaces, . , : ( ) + _ -). Never a command line, arguments, paths or settings.');
  }
  return s;
}

// A path relative to the project root, forward slashes, no way out of it.
export function relPath(name, value) {
  const s = String(value ?? '').trim().replace(/\\/g, '/');
  if (!s || s === 'true') usage(`--${name} is required.`);
  if (/(^[/~]|^[A-Za-z]:|\.\.|:\/\/|[?#\s])/.test(s)) usage(`--${name} must be a path relative to the project, with no "..".`);
  return s;
}

/* ---------------------------------------------------------------- hashes */

export const sha256 = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex');

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export const PACKET_FIELDS = Object.freeze(['gate_key', 'gate_kind', 'level', 'question', 'why_now', 'exact_action',
  'options', 'recommended_option', 'recommended_reason', 'verified_evidence', 'not_verified', 'risks',
  'requested_at', 'expires_at']);
const LIST_FIELDS = ['verified_evidence', 'not_verified', 'risks'];

// The packet exactly as the Control Room normalises it before hashing: absent lists [], absent
// strings null, instants as toISOString(), options with exactly key/label/consequence/authorizes.
export function packetOf(g) {
  const p = {};
  for (const k of PACKET_FIELDS) p[k] = g[k] ?? (LIST_FIELDS.includes(k) ? [] : null);
  p.requested_at = p.requested_at ? new Date(p.requested_at).toISOString() : null;
  p.expires_at = p.expires_at ? new Date(p.expires_at).toISOString() : null;
  p.options = (p.options || []).map((o) => ({ key: o.key, label: o.label, consequence: o.consequence, authorizes: Boolean(o.authorizes) }));
  return p;
}
export const packetHash = (g) => sha256(canonicalJson(packetOf(g)));

/* ----------------------------------------------------------------- times */

export const nowIso = (now = new Date()) => new Date(now).toISOString();
// RUN-LOG label: "YYYY-MM-DD HH:MM Z" (always UTC, always with its zone).
export const stamp = (now = new Date()) => { const s = new Date(now).toISOString(); return `${s.slice(0, 10)} ${s.slice(11, 16)} Z`; };

/* ----------------------------------------------------------------- paths */

export function projectPaths(rootArg) {
  const root = resolve(String(rootArg && rootArg !== true ? rootArg : process.cwd()));
  const jmw = join(root, '.jmw');
  return { root, jmw, runs: join(jmw, 'runs'), gates: join(jmw, 'gates'), runLog: join(jmw, 'RUN-LOG.md'),
    status: join(jmw, 'STATUS.md'), decisions: join(jmw, 'DECISIONS.md'), policy: join(jmw, 'run-policy.json') };
}
export function requireJmw(paths) {
  if (!existsSync(paths.jmw)) usage('No .jmw folder in that project. Run the installer first (scripts/install-jmw-agents.ps1).');
}
// Resolves a project-relative path and makes sure it stays inside the project.
export function inside(root, rel) {
  const full = resolve(root, rel);
  if (full !== root && !full.startsWith(root + sep)) usage('Path must stay inside the project.');
  return full;
}

/* ----------------------------------------------------------- state files */

const stripComments = (t) => String(t ?? '').replace(/<!--[\s\S]*?-->/g, '');

// "- key: value" lines of STATUS.md's CURRENT block. Placeholders like "(none)" read as null.
export function readStatus(paths) {
  if (!existsSync(paths.status)) return {};
  const out = {};
  let inCurrent = false;
  for (const line of stripComments(readFileSync(paths.status, 'utf8')).split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { inCurrent = /^current$/i.test(h[1]); continue; }
    const m = inCurrent && /^\s*-\s+([a-z_0-9]+)\s*:\s*(.*?)\s*$/i.exec(line);
    if (m && !(m[1] in out)) out[m[1]] = m[2] === '' || /^\(.*\)$/.test(m[2]) ? null : m[2];
  }
  return out;
}

// RUN-START / RUN-END bracketing, parsed with the same grammar as the Control Room.
export function readRuns(paths) {
  if (!existsSync(paths.runLog)) return [];
  const runs = new Map();
  for (const raw of stripComments(readFileSync(paths.runLog, 'utf8')).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('- ')) continue;
    const parts = line.slice(2).split('|').map((p) => p.trim());
    if (parts[1] === 'RUN-START' && KEY_PATTERNS.run.test(parts[2] ?? '') && !runs.has(parts[2])) {
      const resumed = /^resumed_from:\s*(\S+)$/i.exec(parts[7] ?? '')?.[1];
      runs.set(parts[2], { run_key: parts[2], mode: parts[4], workflow: parts[5],
        resumed_from: resumed && resumed.toLowerCase() !== 'none' ? resumed : null, ended: false, end_status: null });
    } else if (parts[1] === 'RUN-END' && runs.has(parts[2])) {
      Object.assign(runs.get(parts[2]), { ended: true, end_status: String(parts[3] ?? '').toLowerCase().replace(/-/g, '_') });
    }
  }
  return [...runs.values()];
}

// One line, no pipes or line breaks inside a field.
const cell = (v) => String(v ?? 'none').replace(/[|\r\n]+/g, '/').trim() || 'none';
export function appendRunLog(paths, fields, now = new Date()) {
  let text = existsSync(paths.runLog) ? readFileSync(paths.runLog, 'utf8') : '# Run Log\n\n';
  if (!text.endsWith('\n')) text += '\n';
  writeFileSync(paths.runLog, `${text}- ${[stamp(now), ...fields].map(cell).join(' | ')}\n`);
}

export function loadPolicy(paths) {
  if (!existsSync(paths.policy)) return {};
  try { return JSON.parse(readFileSync(paths.policy, 'utf8')); }
  catch { return usage('.jmw/run-policy.json is not valid JSON.'); }
}

/* ---------------------------------------------------------------- ledger */

export const ledgerFile = (paths, runKey) => join(paths.runs, `${runKey}.json`);

export function listLedgers(paths) {
  if (!existsSync(paths.runs)) return [];
  return readdirSync(paths.runs).filter((f) => /^R-.*\.json$/.test(f)).map((f) => {
    try { return JSON.parse(readFileSync(join(paths.runs, f), 'utf8')); } catch { return null; }
  }).filter((l) => l?.run?.run_key);
}

export function readLedger(paths, runKey) {
  const file = ledgerFile(paths, runKey);
  if (!existsSync(file)) usage(`No run ledger for ${runKey} in .jmw/runs/.`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

// A small cross-process lock so a watchdog and the PM never write the ledger at the same moment.
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
export function withLock(paths, fn) {
  mkdirSync(paths.runs, { recursive: true });
  const lock = join(paths.runs, '.lock');
  for (let i = 0; ; i += 1) {
    try { closeSync(openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > 30000) { unlinkSync(lock); continue; } } catch { /* raced */ }
      if (i > 200) usage('The run ledger is locked by another JMW command. Try again.');
      sleepMs(25);
    }
  }
  try { return fn(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

export function updateLedger(paths, runKey, mutate) {
  return withLock(paths, () => {
    const L = readLedger(paths, runKey);
    const out = mutate(L) ?? L;
    writeJsonAtomic(ledgerFile(paths, runKey), out);
    return out;
  });
}
export function createLedger(paths, ledger) {
  return withLock(paths, () => {
    const file = ledgerFile(paths, ledger.run.run_key);
    if (existsSync(file)) refuse(`A run ledger for ${ledger.run.run_key} already exists.`);
    writeJsonAtomic(file, ledger);
    return ledger;
  });
}
export const writeLedgerUnlocked = (paths, L) => writeJsonAtomic(ledgerFile(paths, L.run.run_key), L);

/* -------------------------------------------------------- host + process */

export function hostLabel(name = hostname()) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'workstation';
}

export function gitInfo(root) {
  const git = (...a) => {
    try { return execFileSync('git', a, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim(); }
    catch { return null; }
  };
  const head = git('rev-parse', 'HEAD');
  if (!head) return null;
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  return { branch: branch && branch !== 'HEAD' && !hasAbsolutePath(branch) && !looksSecret(branch) ? branch.slice(0, 120) : null,
    head_commit: KEY_PATTERNS.sha.test(head) ? head : null };
}

// True when a process with that pid exists (EPERM means it exists but belongs to someone else).
export function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Ends a process and its children. POSIX: the process group (spawned detached), TERM then KILL.
// Windows: taskkill /T /F.
export function killTree(pid, { group = true } = {}) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  const target = group ? -pid : pid;
  try { process.kill(target, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { return; } }
  const until = Date.now() + 3000;
  while (Date.now() < until && isAlive(pid)) sleepMs(100);
  if (isAlive(pid)) { try { process.kill(target, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
}

export const maxLevelOf = (levels) => (levels ?? []).reduce((m, l) => (levelRank(l) > levelRank(m) ? l : m), 'L0');

// What a pid is now: its program name, and on Linux its start time. Used to avoid treating a
// recycled pid as our process (never kill or flag a program the run did not start).
export function processIdentity(pid) {
  try {
    if (process.platform === 'linux') {
      const name = readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      let startedAt = null;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
        const btime = Number(/^btime\s+(\d+)/m.exec(readFileSync('/proc/stat', 'utf8'))?.[1]);
        if (Number.isFinite(ticks) && Number.isFinite(btime)) startedAt = new Date((btime + ticks / 100) * 1000).toISOString();
      } catch { /* start time is optional */ }
      return { name, startedAt };
    }
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, windowsHide: true }).toString();
      const name = /^"([^"]+)"/m.exec(out)?.[1];
      return name ? { name, startedAt: null } : null;
    }
    const name = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
    return name ? { name: name.split('/').pop(), startedAt: null } : null;
  } catch { return null; }
}

const KIND_NAMES = { godot: /godot/i, ffmpeg: /ffmpeg|ffprobe/i, imagemagick: /magick|convert/i, playwright: /node|chrom|headless|firefox|webkit|msedge|playwright/i,
  browser: /chrom|headless|firefox|webkit|msedge|safari/i, browser_recorder: /chrom|headless|firefox|msedge|obs|ffmpeg|node/i, node: /node/i, python: /python|^py(\.exe)?$/i };
// True only when the pid is alive AND still looks like the program the run registered.
export function stillOurs(p) {
  if (!isAlive(p.pid)) return false;
  const id = processIdentity(p.pid);
  if (!id) return process.platform !== 'linux'; // could not inspect: alive is all we know
  const re = KIND_NAMES[p.kind];
  if (re && !re.test(id.name)) return false;
  if (id.startedAt && p.process_started_at && Math.abs(Date.parse(id.startedAt) - Date.parse(p.process_started_at)) > 120000) return false;
  return true;
}

// Robust "is this file the entry point" check (symlinked temp folders, Windows drive case).
export function isMain(metaUrl) {
  try { return realpathSync(fileURLToPath(metaUrl)).toLowerCase() === realpathSync(resolve(process.argv[1] ?? '')).toLowerCase(); }
  catch { return false; }
}
