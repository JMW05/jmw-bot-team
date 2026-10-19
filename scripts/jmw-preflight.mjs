#!/usr/bin/env node
// Resource preflight. Run it before any heavy step (Godot headless, capture/FFmpeg, ImageMagick,
// Playwright or a browser, big test runs). It is read-only towards the workstation: it measures
// free RAM, free disk on the project drive and on the temp drive, and how many heavy programs
// are already running. When the workstation is critically constrained it refuses (exit 3), prints
// a plain reason, and, given --run and --task-key, records the task as blocked in the run ledger
// so the block reaches Bot Ops. jmw-run.mjs spawn runs this automatically for heavy kinds.
//
//   node scripts/jmw-preflight.mjs [--project-root <dir>] [--run R-... --task-key T-...] [--kind godot]
//        [--min-free-ram-mb N] [--min-free-disk-mb N] [--min-free-temp-mb N] [--max-heavy-running N]
//        [--skip-process-count] [--json]
//
// Thresholds: command line > .jmw/run-policy.json "preflight" > the defaults below.
// Exit: 0 ok (warnings may be printed), 3 blocked, 2 usage.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import {
  EXIT, flagInt, isMain, keyed, maxLevelOf, KEY_PATTERNS, loadPolicy, nowIso, parseArgs, projectPaths, readStatus, appendRunLog, runCli,
  sha256, updateLedger, usage,
} from './jmw-lib.mjs';

export const DEFAULT_THRESHOLDS = Object.freeze({
  min_free_ram_mb: 2048, // below this, heavy work is refused
  warn_free_ram_mb: 4096, // below this, a warning only
  min_free_disk_project_mb: 5120, // captures and builds land on the project drive
  warn_free_disk_project_mb: 10240,
  min_free_disk_temp_mb: 2048, // engines, browsers and encoders write scratch files to temp
  warn_free_disk_temp_mb: 5120,
  max_heavy_running: 2, // refuse when this many heavy programs are already running
});

const MB = 1024 * 1024;
// Program names counted as heavy when already running. A normal desktop browser is not counted,
// only headless browser shells, so Jana's own Chrome never blocks the bots.
const HEAVY_NAME = /^(godot[\w.-]*|ffmpeg|ffprobe|magick|headless_shell|chrome-headless-shell)(\.exe)?$/i;

function processNames() {
  if (process.platform === 'linux') {
    return readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map((d) => {
      try { return readFileSync(`/proc/${d}/comm`, 'utf8').trim(); } catch { return null; }
    }).filter(Boolean);
  }
  if (process.platform === 'win32') {
    const out = execFileSync('tasklist', ['/fo', 'csv', '/nh'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, windowsHide: true }).toString();
    return out.split(/\r?\n/).map((l) => /^"([^"]+)"/.exec(l)?.[1]).filter(Boolean);
  }
  const out = execFileSync('ps', ['-axo', 'comm='], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).toString();
  return out.split(/\r?\n/).map((l) => l.trim().split('/').pop()).filter(Boolean);
}

export const defaultProbes = {
  freeRamMb: () => Math.floor(freemem() / MB),
  totalRamMb: () => Math.floor(totalmem() / MB),
  freeDiskMb: (dir) => { const s = statfsSync(dir); return Math.floor((Number(s.bavail) * Number(s.bsize)) / MB); },
  heavyRunning: () => processNames().filter((n) => HEAVY_NAME.test(n)).map((n) => n.replace(/\.exe$/i, '').toLowerCase()),
  tempDir: () => tmpdir(),
};

const fmt = (mb) => (mb >= 10240 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

// Pure apart from the probes. Returns { status: ok|warn|blocked, checks[], reasons[], text }.
export function preflight({ projectRoot, thresholds = {}, probes = defaultProbes, countProcesses = true, kind = null } = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const checks = [];
  const measure = (name, label, fn, min, warn) => {
    let value = null;
    try { value = fn(); } catch { value = null; }
    const state = value === null ? 'unknown' : value < min ? 'block' : value < warn ? 'warn' : 'ok';
    checks.push({ name, label, value_mb: value, min_mb: min, warn_mb: warn, state });
  };
  measure('free_ram', 'free RAM', () => probes.freeRamMb(), t.min_free_ram_mb, t.warn_free_ram_mb);
  measure('free_disk_project', 'free disk (project drive)', () => probes.freeDiskMb(projectRoot), t.min_free_disk_project_mb, t.warn_free_disk_project_mb);
  measure('free_disk_temp', 'free disk (temp drive)', () => probes.freeDiskMb(probes.tempDir()), t.min_free_disk_temp_mb, t.warn_free_disk_temp_mb);
  if (countProcesses) {
    let running = null;
    try { running = probes.heavyRunning(); } catch { running = null; }
    checks.push({ name: 'heavy_running', label: 'heavy programs already running', count: running?.length ?? null,
      names: running ? [...new Set(running)].slice(0, 10) : [], max: t.max_heavy_running,
      state: running === null ? 'unknown' : running.length >= t.max_heavy_running ? 'block' : 'ok' });
  }
  const reasons = checks.filter((c) => c.state === 'block').map((c) => (c.name === 'heavy_running'
    ? `${c.count} heavy programs are already running (${c.names.join(', ')}); the limit is ${c.max}. Let them finish or close them first.`
    : `${c.label} is ${fmt(c.value_mb)}, below the ${fmt(c.min_mb)} minimum.`));
  const status = reasons.length ? 'blocked' : checks.some((c) => c.state === 'warn') ? 'warn' : 'ok';
  const lines = [`JMW resource preflight${kind ? ` for ${kind}` : ''}: ${status.toUpperCase()}`];
  for (const c of checks) {
    lines.push(c.name === 'heavy_running'
      ? `  ${c.label.padEnd(32)} ${c.count === null ? 'unknown' : `${c.count}${c.names.length ? ` (${c.names.join(', ')})` : ''}`}  limit ${c.max}  ${c.state}`
      : `  ${c.label.padEnd(32)} ${c.value_mb === null ? 'unknown' : fmt(c.value_mb)}  minimum ${fmt(c.min_mb)}, warn below ${fmt(c.warn_mb)}  ${c.state}`);
  }
  if (reasons.length) {
    lines.push('Refused: heavy work (Godot, capture, browser, big test runs) was NOT started, because results on a starved');
    lines.push('workstation are unreliable. Free memory or disk space (close programs, empty temp, move old captures), then run again.');
    for (const r of reasons) lines.push(`  - ${r}`);
  } else if (checks.some((c) => c.state === 'unknown')) {
    lines.push('Note: a measurement was not available on this workstation; it was not used to block.');
  }
  return { status, checks, reasons, text: lines.join('\n') };
}

export function thresholdsFrom(flags, policy) {
  const p = policy?.preflight ?? {};
  const pick = (key, flag) => flagInt(flags[flag], flag) ?? (Number.isInteger(p[key]) ? p[key] : undefined);
  const out = {};
  for (const [key, flag] of [['min_free_ram_mb', 'min-free-ram-mb'], ['warn_free_ram_mb', 'warn-free-ram-mb'],
    ['min_free_disk_project_mb', 'min-free-disk-mb'], ['warn_free_disk_project_mb', 'warn-free-disk-mb'],
    ['min_free_disk_temp_mb', 'min-free-temp-mb'], ['warn_free_disk_temp_mb', 'warn-free-temp-mb'],
    ['max_heavy_running', 'max-heavy-running']]) {
    const v = pick(key, flag);
    if (v !== undefined && v !== null) out[key] = v;
  }
  // A lowered minimum also lowers its warning level, so a warning never sits below the minimum.
  for (const [min, warn] of [['min_free_ram_mb', 'warn_free_ram_mb'], ['min_free_disk_project_mb', 'warn_free_disk_project_mb'],
    ['min_free_disk_temp_mb', 'warn_free_disk_temp_mb']]) {
    const m = out[min] ?? DEFAULT_THRESHOLDS[min];
    if ((out[warn] ?? DEFAULT_THRESHOLDS[warn]) < m) out[warn] = m;
  }
  return out;
}

// Records a refused preflight against a started task: blocked, with the reason, plus a small
// evidence file holding only the numbers (no paths, no names).
export function recordBlock(paths, runKey, taskKey, result, now = new Date()) {
  const summary = `Resource preflight refused heavy work: ${result.reasons.join(' ')}`.slice(0, 1000);
  const day = nowIso(now).slice(0, 10);
  const rel = `.jmw/artifacts/evidence/${day}_${taskKey}_preflight-blocked.txt`;
  mkdirSync(join(paths.jmw, 'artifacts', 'evidence'), { recursive: true });
  const body = `${result.text}\nChecked at ${nowIso(now)}.\n`;
  writeFileSync(join(paths.root, rel), body);
  let level = 'L0';
  let agent = 'jmw-project-manager';
  const L = updateLedger(paths, runKey, (L) => {
    const task = [...(L.tasks ?? [])].reverse().find((t) => t.task_key === taskKey);
    if (!task) usage(`${taskKey} is not a task of ${runKey}. Start it with jmw-run.mjs task-start first.`);
    Object.assign(task, { status: 'blocked', result_summary: summary, human_required: true,
      human_reason: 'Workstation resources are too low for heavy work' });
    level = maxLevelOf(task.allowed_levels);
    agent = task.agent;
    L.artifacts = (L.artifacts ?? []).filter((a) => a.path_or_url !== rel);
    L.artifacts.push({ kind: 'evidence', location_kind: 'local_only', path_or_url: rel, task_key: taskKey, task_attempt: task.attempt,
      sha256: sha256(body), bytes: Buffer.byteLength(body), captured_at: nowIso(now), sensitive_checked: true });
    L.run.last_progress_at = nowIso(now);
    return L;
  });
  const state = readStatus(paths).current_state ?? L.run.state_at_start ?? 'UNKNOWN';
  appendRunLog(paths, [taskKey, agent, level, 'blocked', `${state} -> ${state}`, rel, 'resource preflight refused heavy work'], now);
  return rel;
}

async function main(argv) {
  const { flags } = parseArgs(argv);
  const paths = projectPaths(flags['project-root']);
  if (!existsSync(paths.root)) usage('Project root does not exist.');
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run, { required: false });
  const taskKey = keyed('task-key', flags['task-key'], KEY_PATTERNS.task, { required: false });
  if (Boolean(runKey) !== Boolean(taskKey)) usage('Pass --run and --task-key together (or neither).');
  const result = preflight({ projectRoot: paths.root, thresholds: thresholdsFrom(flags, loadPolicy(paths)),
    countProcesses: !flags['skip-process-count'], kind: typeof flags.kind === 'string' ? flags.kind : null });
  if (flags.json) process.stdout.write(`${JSON.stringify({ status: result.status, checks: result.checks, reasons: result.reasons }, null, 2)}\n`);
  else console.log(result.text);
  if (result.status !== 'blocked') return EXIT.OK;
  if (runKey) {
    const rel = recordBlock(paths, runKey, taskKey, result);
    console.error(`Recorded in the run ledger: ${taskKey} blocked (evidence ${rel}).`);
  } else {
    console.error('Not recorded in a run ledger (no --run/--task-key). Record the task as blocked with this reason.');
  }
  return EXIT.PREFLIGHT_BLOCKED;
}

if (isMain(import.meta.url)) runCli(main);
