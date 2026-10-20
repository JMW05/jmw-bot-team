#!/usr/bin/env node
// The PM's run ledger and run boundaries for Bot Ops. Local files only: no network, no credentials.
//
//   node scripts/jmw-run.mjs <command> --project-root <dir> [options]
//
// Commands (details: BOT-OPS-JMW-HANDOFF.md):
//   start          RUN-START, new run key R-YYYY-MM-DD-<project>-NN, resume + crash-loop detection
//   end            RUN-END with a status, end state and reason
//   task-start     route a task (attempt numbering, budget, no blind L2+ retry)
//   task-end       finish a task and append its RUN-LOG step line
//   step           heartbeat: run.last_progress_at, optional RUN-LOG line for a PM step
//   spawn          run a heavy/long program with preflight, timeout budget and process record
//   proc-register  record a process started some other way (pid, kind, safe label)
//   proc-end       record how a registered process ended
//   proc-cleanup   end an orphaned process this project registered, and record it
//   gate-raise     write an immutable human-gate packet .jmw/gates/<gate_key>.json
//   gate-consume   use a person's answer to a gate once, after checking it
//   artifact       record evidence in the ledger
//   feedback       record framework feedback FF-<project>-<slug> for jmw-bot-team
//   resume-check   read-only: would a new run resume, and is there a crash loop?
//
// The ledger .jmw/runs/<run_key>.json holds exactly the report's run, tasks, artifacts, processes,
// gate_consumptions, framework_feedback and gates (keys), plus repo and project.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  appendRunLog, ARTIFACT_KINDS, BOT_LEVELS, createLedger, EXIT, FEEDBACK_COMPONENTS, FEEDBACK_SEVERITIES, flagBool, flagInt,
  flagList, GATE_KINDS, GATE_MAX_DAYS, gitInfo, HEAVY_KINDS, inside, isMain, keyed, KEY_PATTERNS, killTree, L4_OPTION_KEYS,
  LEVELS, levelRank, listLedgers, loadPolicy, LOCATION_KINDS, maxLevelOf, MODE_MAX_LEVEL, nowIso, oneOf, packetHash, packetOf,
  parseArgs, PROCESS_KINDS, projectPaths, readLedger, readRuns, readStatus, refuse, relPath, requireJmw, RUN_STATUSES, runCli,
  safeLabel, safeText, stillOurs, updateLedger, usage, withLock, WORKFLOWS, writeLedgerUnlocked,
} from './jmw-lib.mjs';
import { preflight, recordBlock, thresholdsFrom } from './jmw-preflight.mjs';

export const DEFAULT_TIMEOUTS_MIN = Object.freeze({ godot: 10, ffmpeg: 15, browser_recorder: 15, imagemagick: 5,
  playwright: 20, browser: 20, test_runner: 20, dev_server: 60, node: 20, python: 20, other: 20 });
export const DEFAULT_STALL_MIN = 3;
const DEFAULT_BOT = 'jmw-project-manager';

const dur = (ms) => (ms < 120000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 6000) / 10} min`);
const say = (...lines) => console.log(lines.join('\n'));
const runningRun = (L) => { if (L.run.status !== 'running') refuse(`${L.run.run_key} is not running (status ${L.run.status}). Start a new run.`); };
const normStatus = (s) => String(s ?? '').trim().toLowerCase().replace(/-/g, '_');
const logStatus = (s) => s.replace(/_/g, '-');

function projectSlug(paths, flags) {
  const slug = flags.project && flags.project !== true ? String(flags.project) : readStatus(paths).project;
  if (!slug || !KEY_PATTERNS.project.test(slug)) usage('Project slug not found: pass --project or set "- project:" in .jmw/STATUS.md (lowercase letters, digits, -).');
  return slug;
}
const currentState = (paths, L) => readStatus(paths).current_state ?? L.run.state_at_end ?? L.run.state_at_start ?? 'UNKNOWN';

/* ------------------------------------------------------------ resume */

// Reads RUN-LOG: the latest run, whether it ended, and how many runs in a row ended interrupted.
export function analyseResume(paths) {
  const runs = readRuns(paths);
  const latest = runs.at(-1) ?? null;
  const isInterrupted = (r) => !r.ended || r.end_status === 'interrupted';
  let streak = 0;
  for (let i = runs.length - 1; i >= 0 && isInterrupted(runs[i]); i -= 1) streak += 1;
  const open = latest && !latest.ended ? latest : null;
  const ledgers = new Map(listLedgers(paths).map((L) => [L.run.run_key, L]));
  const prev = open ? ledgers.get(open.run_key) ?? null : null;
  const unfinished = (prev?.tasks ?? []).filter((t) => ['queued', 'running', 'interrupted'].includes(t.status))
    .map((t) => ({ task_key: t.task_key, attempt: t.attempt, top_level: maxLevelOf(t.allowed_levels) }));
  const processes = (prev?.processes ?? []).filter((p) => ['running', 'orphaned'].includes(p.status))
    .map((p) => ({ pid: p.pid, kind: p.kind, label: p.label, alive: stillOurs(p) }));
  return { latest_run: latest?.run_key ?? null, interrupted_run: open?.run_key ?? null, interrupted_streak: streak,
    crash_loop: streak >= 2, unfinished_tasks: unfinished, processes, runs_interrupted: runs.slice(runs.length - streak).map((r) => r.run_key) };
}

// The dead run's own ledger: it stopped without RUN-END, so it is interrupted; its unfinished tasks
// are interrupted (effect unknown); its processes are orphaned if still alive, unknown if gone.
function reconcileInterrupted(paths, prevKey, newKey, now) {
  const file = join(paths.runs, `${prevKey}.json`);
  if (!existsSync(file)) return [];
  let carried = [];
  withLock(paths, () => {
    const L = JSON.parse(readFileSync(file, 'utf8'));
    if (L.run.status === 'running') {
      Object.assign(L.run, { status: 'interrupted', finished_at: L.run.last_progress_at ?? L.run.started_at,
        stop_reason: `No RUN-END. Found interrupted by ${newKey}; unfinished work is unknown until verified.` });
    }
    for (const t of L.tasks ?? []) {
      if (['queued', 'running'].includes(t.status)) {
        t.status = 'interrupted';
        t.result_summary = t.result_summary ?? 'The run stopped before this task finished. Its effect is unknown until verified.';
      }
    }
    for (const p of L.processes ?? []) {
      if (p.status !== 'running') continue;
      if (stillOurs(p)) Object.assign(p, { status: 'orphaned', cleanup_required: true, last_seen_at: nowIso(now) });
      else p.status = 'unknown';
    }
    writeLedgerUnlocked(paths, L);
    carried = (L.processes ?? []).filter((p) => ['orphaned', 'unknown'].includes(p.status) && !p.run_key)
      .map((p) => ({ ...p, run_key: prevKey }));
  });
  return carried;
}

/* ----------------------------------------------------------- start/end */

function cmdStart(paths, flags, now = new Date()) {
  requireJmw(paths);
  const status = readStatus(paths);
  const project = projectSlug(paths, flags);
  const mode = keyed('mode', flags.mode ?? status.mode, KEY_PATTERNS.mode);
  const workflow = oneOf('workflow', flags.workflow ?? status.workflow, WORKFLOWS);
  const bot = keyed('bot', flags.bot ?? DEFAULT_BOT, KEY_PATTERNS.bot);
  const from = safeText('--from (state at start)', flags.from ?? status.current_state, { max: 60, required: true });
  const targetRaw = flags.target ?? status.target_state;
  const target = targetRaw && String(targetRaw).toLowerCase() !== 'none' ? safeText('--target', targetRaw, { max: 60 }) : null;
  const modeMax = MODE_MAX_LEVEL[mode];
  if (flags['max-level'] === 'L4') refuse('L4 is never autonomous. No run can have max level L4.');
  const asked = flags['max-level'] ? oneOf('max-level', flags['max-level'], BOT_LEVELS) : null;
  if (!asked && !modeMax) usage(`Mode ${mode} is not a built-in mode: pass --max-level (L0-L3).`);
  const maxLevel = asked ?? modeMax;
  if (modeMax && asked && levelRank(asked) > levelRank(modeMax) && asked !== 'L3') refuse(`Mode ${mode} allows at most ${modeMax}.`);
  const budget = flagInt(flags['task-budget'], 'task-budget', { min: 1, max: 10000 }) ?? 25;

  const label = flags['run-label'] ? keyed('run-label', flags['run-label'], /^[a-z0-9][a-z0-9-]{0,39}$/) : project.slice(0, 40).replace(/-+$/, '');
  const day = nowIso(now).slice(0, 10);
  const prefix = `R-${day}-${label}-`;
  const used = new Set([...readRuns(paths).map((r) => r.run_key), ...(existsSync(paths.runs) ? readdirSync(paths.runs).map((f) => f.replace(/\.json$/, '')) : [])]);
  let n = 1;
  for (const k of used) { const m = k.startsWith(prefix) && /^(\d+)$/.exec(k.slice(prefix.length)); if (m) n = Math.max(n, Number(m[1]) + 1); }
  const runKey = `${prefix}${String(n).padStart(2, '0')}`;
  if (!KEY_PATTERNS.run.test(runKey)) usage('Run key would be too long: pass a shorter --run-label.');

  const resume = analyseResume(paths);
  const resumedFrom = resume.interrupted_run;
  const carried = resumedFrom ? reconcileInterrupted(paths, resumedFrom, runKey, now) : [];
  const started = nowIso(now);
  const ledger = {
    schema: 'jmw-run-ledger/1', project, repo: gitInfo(paths.root),
    run: { run_key: runKey, bot, mode, workflow, max_level: maxLevel, state_at_start: from, target_state: target, state_at_end: null,
      status: 'running', stop_reason: null, started_at: started, last_progress_at: started, finished_at: null,
      resumed_from_run_key: resumedFrom, tasks_routed: 0, task_budget: budget, cost_usd: null },
    tasks: [], artifacts: [], processes: carried, gate_consumptions: [], framework_feedback: [], gates: [],
  };
  if (resume.crash_loop) {
    const reason = `Crash loop: ${resume.runs_interrupted.join(' and ')} ended interrupted in a row. Not retrying; a person must find out why.`.slice(0, 300);
    Object.assign(ledger.run, { status: 'blocked', state_at_end: from, stop_reason: reason, finished_at: started });
    createLedger(paths, ledger);
    appendRunLog(paths, ['RUN-START', runKey, bot, mode, workflow, `${from} -> ${target ?? 'none'}`, `resumed_from: ${resumedFrom ?? 'none'}`], now);
    appendRunLog(paths, ['RUN-END', runKey, 'blocked', from, reason], now);
    console.error(`RUN ${runKey} BLOCKED\n${reason}`);
    return EXIT.CRASH_LOOP;
  }
  createLedger(paths, ledger);
  appendRunLog(paths, ['RUN-START', runKey, bot, mode, workflow, `${from} -> ${target ?? 'none'}`, `resumed_from: ${resumedFrom ?? 'none'}`], now);
  const out = [`RUN ${runKey}`, `max level ${maxLevel}, budget ${budget} tasks, ledger .jmw/runs/${runKey}.json`];
  if (resumedFrom) {
    out.push(`Resumed from ${resumedFrom}, which has no RUN-END (interrupted). Its unfinished tasks are now interrupted:`);
    for (const t of resume.unfinished_tasks) {
      out.push(`  ${t.task_key} attempt ${t.attempt} (${t.top_level})${levelRank(t.top_level) >= 2 ? ' - L2+: verify whether its effect happened before retrying; task-start needs --prior-attempt-effect verified_absent|verified_present' : ' - may simply be re-run'}`);
    }
    for (const p of carried) out.push(`  process ${p.pid} (${p.kind}, ${p.label}): ${p.status === 'orphaned' ? 'STILL RUNNING, nobody owns it - clean up with proc-cleanup' : 'gone, outcome unknown'}`);
  }
  say(...out);
  return EXIT.OK;
}

function closeOpenWork(L, now, why) {
  const warnings = [];
  for (const t of L.tasks) {
    if (['queued', 'running'].includes(t.status)) {
      t.status = 'interrupted';
      t.result_summary = t.result_summary ?? why;
      warnings.push(`task ${t.task_key} had no task-end: recorded as interrupted`);
    }
  }
  for (const p of L.processes) {
    if (p.status !== 'running') continue;
    if (stillOurs(p)) { Object.assign(p, { status: 'orphaned', cleanup_required: true, last_seen_at: nowIso(now) }); warnings.push(`process ${p.pid} (${p.kind}) is still running: orphaned, cleanup required`); }
    else { p.status = 'unknown'; warnings.push(`process ${p.pid} (${p.kind}) ended without an exit record: unknown`); }
  }
  return warnings;
}

function cmdEnd(paths, flags, now = new Date()) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const status = normStatus(flags.status);
  if (!RUN_STATUSES.includes(status) || ['running', 'interrupted'].includes(status)) {
    usage('--status must be one of: succeeded, stopped-human-gate, stopped-no-eligible-work, blocked, budget-exhausted, failed, cancelled.');
  }
  const reason = safeText('--reason', flags.reason, { max: 300, required: status !== 'succeeded' });
  let warnings = [];
  let state;
  const L = updateLedger(paths, runKey, (L) => {
    runningRun(L);
    state = safeText('--state', flags.state ?? currentState(paths, L), { max: 60, required: true });
    warnings = closeOpenWork(L, now, 'Not finished when the run ended. Its effect is unknown until verified.');
    L.repo = gitInfo(paths.root) ?? L.repo;
    Object.assign(L.run, { status, state_at_end: state, stop_reason: reason, finished_at: nowIso(now), last_progress_at: nowIso(now) });
    return L;
  });
  appendRunLog(paths, ['RUN-END', runKey, logStatus(status), state, reason ?? 'target reached'], now);
  say(`RUN-END ${runKey} ${logStatus(status)} at ${state}`, ...warnings.map((w) => `WARNING: ${w}`));
  return L ? EXIT.OK : EXIT.ERROR;
}

/* --------------------------------------------------------------- tasks */

function cmdTaskStart(paths, flags) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const taskKey = keyed('task-key', flags['task-key'], KEY_PATTERNS.task);
  const agent = keyed('agent', flags.agent, KEY_PATTERNS.bot);
  const goal = safeText('--goal', flags.goal, { max: 500, required: true });
  const levels = flagList(flags.levels);
  if (!levels.length) usage('--levels is required, for example L0,L1.');
  if (levels.includes('L4')) refuse('L4 is never autonomous. Raise an l4_handoff gate for a person instead.');
  for (const l of levels) if (!BOT_LEVELS.includes(l)) usage('--levels may only contain L0, L1, L2, L3.');
  const top = maxLevelOf(levels);
  const caps = flagList(flags.capabilities);
  for (const c of caps) if (!KEY_PATTERNS.capability.test(c)) usage('--capabilities must be capability names such as game_qa.');
  const prohibited = flagList(flags.prohibited).map((p) => safeText('--prohibited item', p, { max: 120 }));
  const effectFlag = flags['prior-attempt-effect'] ? oneOf('prior-attempt-effect', flags['prior-attempt-effect'], ['not_applicable', 'verified_absent', 'verified_present']) : null;

  const others = listLedgers(paths).filter((L) => L.run.run_key !== runKey);
  let attempt;
  const L = updateLedger(paths, runKey, (L) => {
    runningRun(L);
    if (levelRank(top) > levelRank(L.run.max_level)) refuse(`${taskKey} needs ${top}; this run allows at most ${L.run.max_level}.`);
    if (L.run.tasks_routed >= (L.run.task_budget ?? Infinity)) refuse(`Run budget of ${L.run.task_budget} tasks is used. End the run with --status budget-exhausted.`);
    const all = [...others.flatMap((o) => (o.tasks ?? []).map((t) => ({ t, runStatus: o.run.status, current: false }))),
      ...L.tasks.map((t) => ({ t, runStatus: L.run.status, current: true }))].filter((x) => x.t.task_key === taskKey);
    const prev = all.sort((a, b) => a.t.attempt - b.t.attempt).at(-1) ?? null;
    if (prev?.current && ['queued', 'running'].includes(prev.t.status)) refuse(`${taskKey} attempt ${prev.t.attempt} is still running in this run. End it first.`);
    attempt = (prev?.t.attempt ?? 0) + 1;
    if (attempt > 20) refuse(`${taskKey} has had 20 attempts. Stop and ask a person.`);
    const prevInterrupted = prev && (prev.t.status === 'interrupted' || (['queued', 'running'].includes(prev.t.status) && prev.runStatus !== 'running'));
    let effect = effectFlag;
    if (prevInterrupted && levelRank(top) >= levelRank('L2') && !['verified_absent', 'verified_present'].includes(effect)) {
      refuse(`${taskKey} attempt ${prev.t.attempt} was interrupted and this is ${top} work. Never retry it blind: check whether its effect happened ` +
        '(branch pushed? PR opened? draft created? staging changed?) and pass --prior-attempt-effect verified_absent or verified_present.');
    }
    if (prev && !effect) effect = 'not_applicable';
    L.tasks.push({ task_key: taskKey, attempt, agent, goal, allowed_levels: levels, prohibited_actions: prohibited,
      required_capabilities: caps, status: 'running', result_summary: null, human_required: false, human_reason: null,
      state_transition_recommended: null, prior_attempt_effect: effect });
    L.run.tasks_routed += 1;
    return L;
  });
  say(`TASK ${taskKey} attempt ${attempt} (${top}) started in ${runKey} (${L.run.tasks_routed}/${L.run.task_budget} routed).`);
  return EXIT.OK;
}

function stepLine(paths, L, flags, { task, agent, level, result, note }) {
  const states = flags.states ? String(flags.states) : null;
  if (states && !/^\s*\S.*->.*\S\s*$/.test(states)) usage('--states must look like "BEFORE -> AFTER".');
  const st = states ?? `${currentState(paths, L)} -> ${currentState(paths, L)}`;
  safeText('--states', st, { max: 130 });
  const evidence = flagList(flags.evidence).map((e) => relPath('evidence', e));
  const lvl = flags.level ? oneOf('level', flags.level, LEVELS) : level;
  appendRunLog(paths, [task, agent, lvl, result, st, evidence.length ? evidence.join(', ') : 'none', note ?? '']);
}

function cmdTaskEnd(paths, flags) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const taskKey = keyed('task-key', flags['task-key'], KEY_PATTERNS.task);
  const status = normStatus(flags.status);
  if (!['done', 'partial', 'failed', 'blocked', 'stopped_human_gate', 'skipped'].includes(status)) {
    usage('--status must be one of: done, partial, failed, blocked, stopped-human-gate, skipped.');
  }
  const summary = safeText('--summary', flags.summary, { max: 1000 });
  const humanRequired = flagBool(flags['human-required'], 'human-required');
  const humanReason = safeText('--human-reason', flags['human-reason'], { max: 300 });
  const transition = safeText('--transition', flags.transition, { max: 120 });
  let task;
  let same = false;
  const warnings = [];
  const L = updateLedger(paths, runKey, (L) => {
    runningRun(L);
    task = [...L.tasks].reverse().find((t) => t.task_key === taskKey);
    if (!task) usage(`${taskKey} is not a task of ${runKey}. Start it with task-start.`);
    if (!['queued', 'running'].includes(task.status)) {
      if (task.status === status) { same = true; return L; }
      refuse(`${taskKey} attempt ${task.attempt} already ended as ${task.status}.`);
    }
    Object.assign(task, { status, result_summary: summary ?? task.result_summary, human_required: humanRequired ?? (status === 'stopped_human_gate'),
      human_reason: humanReason, state_transition_recommended: transition });
    for (const p of L.processes) {
      if (p.task_key === taskKey && p.status === 'running') warnings.push(`process ${p.pid} (${p.kind}) of this task is still recorded as running; record proc-end or clean it up`);
    }
    L.run.last_progress_at = nowIso();
    return L;
  });
  if (same) { say(`${taskKey} already ${status}; nothing changed.`); return EXIT.OK; }
  stepLine(paths, L, flags, { task: taskKey, agent: task.agent, level: maxLevelOf(task.allowed_levels), result: logStatus(status),
    note: summary ? summary.slice(0, 160) : '' });
  say(`TASK ${taskKey} attempt ${task.attempt}: ${logStatus(status)}`, ...warnings.map((w) => `WARNING: ${w}`));
  return EXIT.OK;
}

function cmdStep(paths, flags) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const note = safeText('--note', flags.note, { max: 160 });
  const result = flags.result ? normStatus(flags.result) : 'done';
  if (!['done', 'partial', 'failed', 'blocked', 'stopped_human_gate', 'skipped'].includes(result)) usage('--result is not a step result.');
  const L = updateLedger(paths, runKey, (L) => { runningRun(L); L.run.last_progress_at = nowIso(); return L; });
  if (note) stepLine(paths, L, flags, { task: flags['task-key'] ? keyed('task-key', flags['task-key'], KEY_PATTERNS.task) : '-', agent: L.run.bot, level: 'L0', result: logStatus(result), note });
  say(`progress ${runKey} ${L.run.last_progress_at}`);
  return EXIT.OK;
}

/* ------------------------------------------------------------ processes */

function taskOf(L, taskKey) {
  if (!taskKey) return null;
  const t = [...L.tasks].reverse().find((x) => x.task_key === taskKey);
  if (!t) usage(`${taskKey} is not a task of ${L.run.run_key}.`);
  return t;
}
const ports = (flags) => flagList(flags.ports).map((p) => flagInt(p, 'ports', { min: 1, max: 65535 }));

function cmdProcRegister(paths, flags) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const taskKey = keyed('task-key', flags['task-key'], KEY_PATTERNS.task, { required: false });
  const kind = oneOf('kind', flags.kind, PROCESS_KINDS);
  const label = safeLabel(flags.label);
  const pid = flagInt(flags.pid, 'pid', { min: 1 }) ?? usage('--pid is required.');
  let startedAt = nowIso();
  if (flags['started-at']) {
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(String(flags['started-at'])) || Number.isNaN(Date.parse(flags['started-at']))) usage('--started-at must be an ISO time with a zone.');
    startedAt = new Date(flags['started-at']).toISOString();
  }
  updateLedger(paths, runKey, (L) => {
    runningRun(L);
    const t = taskOf(L, taskKey);
    if (L.processes.some((p) => p.pid === pid && p.status === 'running' && !p.run_key)) refuse(`Process ${pid} is already registered as running.`);
    L.processes.push({ task_key: taskKey, task_attempt: t?.attempt ?? null, pid, process_started_at: startedAt, kind, label,
      ports: ports(flags), status: 'running', last_seen_at: nowIso(), cleanup_required: false });
    return L;
  });
  say(`process ${pid} (${kind}) registered in ${runKey}`);
  return EXIT.OK;
}

function cmdProcEnd(paths, flags) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const pid = flagInt(flags.pid, 'pid', { min: 1 }) ?? usage('--pid is required.');
  const status = oneOf('status', flags.status, ['exited_ok', 'exited_error', 'killed']);
  const code = flags['exit-code'] === undefined ? null : flagInt(flags['exit-code'], 'exit-code', { min: -2147483648 });
  updateLedger(paths, runKey, (L) => {
    const p = [...L.processes].reverse().find((x) => x.pid === pid && x.status === 'running');
    if (!p) usage(`No running process ${pid} is registered in ${runKey}.`);
    Object.assign(p, { status, exit_code: code, ended_at: nowIso(), last_seen_at: nowIso() });
    if (L.run.status === 'running') L.run.last_progress_at = nowIso();
    return L;
  });
  say(`process ${pid}: ${status}${code === null ? '' : ` (exit ${code})`}`);
  return EXIT.OK;
}

function cmdProcCleanup(paths, flags) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const pid = flagInt(flags.pid, 'pid', { min: 1 }) ?? usage('--pid is required.');
  const by = safeText('--by', flags.by ?? DEFAULT_BOT, { max: 80 });
  let outcome;
  updateLedger(paths, runKey, (L) => {
    const p = [...L.processes].reverse().find((x) => x.pid === pid && ['orphaned', 'running'].includes(x.status));
    if (!p) usage(`No orphaned or running process ${pid} is recorded in ${runKey}. Only processes this project registered can be cleaned up.`);
    if (stillOurs(p)) {
      killTree(pid);
      outcome = 'killed';
      Object.assign(p, { status: 'killed', ended_at: nowIso(), last_seen_at: nowIso(), cleanup_required: false, cleaned_up_by: by });
    } else {
      outcome = 'already gone (or the pid now belongs to another program; it was not touched)';
      Object.assign(p, { status: 'unknown', cleanup_required: false, cleaned_up_by: by });
    }
    return L;
  });
  say(`process ${pid}: ${outcome}`);
  return EXIT.OK;
}

// Runs one program under a wall-clock budget. Output is written to a log file inside the project
// and counts as progress; at the deadline a program that is still producing output (or growing
// --progress-path) gets more time up to a hard cap, and one that has gone quiet is ended. A timeout
// is recorded as the task failing with the reason. The command line is never recorded anywhere.
export async function spawnWithBudget(paths, flags, cmd, args, { now = () => new Date(), probes } = {}) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const taskKey = keyed('task-key', flags['task-key'], KEY_PATTERNS.task, { required: false });
  const kind = oneOf('kind', flags.kind, PROCESS_KINDS);
  const label = safeLabel(flags.label);
  if (!cmd) usage('Give the program after "--", for example: spawn ... -- godot --headless --quit');
  const policy = loadPolicy(paths);
  const minutes = (v) => (v === undefined ? null : Number(v) * 60000);
  const seconds = (v) => (v === undefined ? null : Number(v) * 1000);
  const timeoutMs = seconds(flags['timeout-sec']) ?? minutes(flags['timeout-min']) ?? minutes(policy.timeouts_min?.[kind]) ?? DEFAULT_TIMEOUTS_MIN[kind] * 60000;
  const stallMs = seconds(flags['stall-sec']) ?? minutes(flags['stall-min']) ?? minutes(policy.stall_min) ?? DEFAULT_STALL_MIN * 60000;
  const hardMs = seconds(flags['max-sec']) ?? minutes(flags['max-min']) ?? timeoutMs * (Number(policy.max_extend_factor) || 2);
  for (const [n, v] of [['timeout', timeoutMs], ['stall', stallMs], ['max', hardMs]]) if (!Number.isFinite(v) || v < 1000) usage(`--${n} must be at least 1 second.`);
  if (hardMs < timeoutMs) usage('The hard cap (--max-min) must be at least the timeout.');

  const L0 = readLedger(paths, runKey);
  runningRun(L0);
  const task = taskOf(L0, taskKey);
  if (task && !['running', 'queued'].includes(task.status)) refuse(`${taskKey} is ${task.status}; start a new attempt first.`);

  if (HEAVY_KINDS.includes(kind) || flags.heavy) {
    const result = preflight({ projectRoot: paths.root, thresholds: thresholdsFrom(flags, policy), kind, probes,
      countProcesses: !flags['skip-process-count'] });
    console.log(result.text);
    if (result.status === 'blocked') {
      if (taskKey) console.error(`Recorded in the run ledger: ${taskKey} blocked (evidence ${recordBlock(paths, runKey, taskKey, result)}).`);
      else console.error('No --task-key: the block is not in the ledger. Record it with task-end --status blocked.');
      return EXIT.PREFLIGHT_BLOCKED;
    }
  }

  const day = nowIso(now()).slice(0, 10);
  const logRel = flags.log ? relPath('log', flags.log) : `.jmw/artifacts/logs/${day}_${taskKey ?? runKey}_${kind}-${Date.now().toString(36)}.log`;
  const logFull = inside(paths.root, logRel);
  mkdirSync(dirname(logFull), { recursive: true });
  const progressFull = flags['progress-path'] ? inside(paths.root, relPath('progress-path', flags['progress-path'])) : null;

  const win = process.platform === 'win32';
  const viaCmd = win && /\.(cmd|bat)$/i.test(cmd);
  const child = spawn(viaCmd ? 'cmd.exe' : cmd, viaCmd ? ['/d', '/c', cmd, ...args] : args,
    { cwd: paths.root, stdio: ['ignore', 'pipe', 'pipe'], detached: !win, windowsHide: true, shell: false });
  const startError = await new Promise((res) => { child.once('spawn', () => res(null)); child.once('error', (e) => res(e)); });
  if (startError) { console.error(`Could not start the program (${startError.code ?? 'error'}). Nothing was recorded.`); return 127; }

  const startedAt = nowIso(now());
  updateLedger(paths, runKey, (L) => {
    L.processes.push({ task_key: taskKey, task_attempt: task?.attempt ?? null, pid: child.pid, process_started_at: startedAt, kind, label,
      ports: ports(flags), status: 'running', last_seen_at: startedAt, cleanup_required: false });
    return L;
  });
  console.log(`process ${child.pid} (${kind}) started; budget ${Math.round(timeoutMs / 1000)} s, quiet limit ${Math.round(stallMs / 1000)} s, hard cap ${Math.round(hardMs / 1000)} s; log ${logRel}`);

  const log = createWriteStream(logFull);
  const t0 = Date.now();
  let lastOutput = t0;
  let lastProbe = '';
  const tee = (stream, out) => stream.on('data', (chunk) => { lastOutput = Date.now(); log.write(chunk); if (!flags.quiet) out.write(chunk); });
  tee(child.stdout, process.stdout);
  tee(child.stderr, process.stderr);
  const probeProgress = () => {
    if (!progressFull || !existsSync(progressFull)) return;
    try {
      const s = statSync(progressFull);
      const sig = s.isDirectory()
        ? readdirSync(progressFull).map((f) => { try { const x = statSync(join(progressFull, f)); return `${f}:${x.size}:${x.mtimeMs}`; } catch { return f; } }).join('|')
        : `${s.size}:${s.mtimeMs}`;
      if (sig !== lastProbe) { lastProbe = sig; lastOutput = Date.now(); }
    } catch { /* treat as no progress */ }
  };
  probeProgress();

  let deadline = t0 + timeoutMs;
  let killedReason = null;
  let lastSeenWrite = t0;
  const tick = Math.max(200, Math.min(5000, Math.floor(stallMs / 4)));
  const timer = setInterval(() => {
    const t = Date.now();
    probeProgress();
    if (t - lastSeenWrite >= 60000) {
      lastSeenWrite = t;
      try { updateLedger(paths, runKey, (L) => { const p = L.processes.find((x) => x.pid === child.pid && x.process_started_at === startedAt); if (p) p.last_seen_at = nowIso(); return L; }); } catch { /* next tick */ }
    }
    if (t < deadline) return;
    const quietFor = t - lastOutput;
    if (quietFor < stallMs && t - t0 < hardMs) {
      deadline = Math.min(t0 + hardMs, t + stallMs);
      console.error(`Budget reached but the program is still producing output; allowing up to ${Math.round((deadline - t) / 1000)} s more (hard cap ${Math.round(hardMs / 1000)} s).`);
      return;
    }
    killedReason = t - t0 >= hardMs && quietFor < stallMs
      ? `Timed out: reached the hard cap of ${dur(hardMs)} while still producing output; process ended.`
      : `Timed out after ${dur(t - t0)} with no new output for ${dur(quietFor)}; process ended.`;
    clearInterval(timer);
    killTree(child.pid, { group: !win });
  }, tick);

  const [code, signal] = await new Promise((res) => child.once('close', (c, s) => res([c, s])));
  clearInterval(timer);
  await new Promise((res) => log.end(res));
  const endedAt = nowIso(now());
  const status = killedReason ? 'killed' : code === 0 ? 'exited_ok' : code === null ? 'killed' : 'exited_error';
  updateLedger(paths, runKey, (L) => {
    const p = L.processes.find((x) => x.pid === child.pid && x.process_started_at === startedAt);
    if (p) Object.assign(p, { status, exit_code: Number.isInteger(code) ? code : null, ended_at: endedAt, last_seen_at: endedAt });
    if (killedReason && taskKey) {
      const tk = [...L.tasks].reverse().find((x) => x.task_key === taskKey);
      if (tk && ['running', 'queued'].includes(tk.status)) Object.assign(tk, { status: 'failed', result_summary: `${label}: ${killedReason}` });
    }
    if (L.run.status === 'running') L.run.last_progress_at = endedAt;
    return L;
  });
  if (killedReason) {
    if (taskKey) {
      const L = readLedger(paths, runKey);
      const tk = [...L.tasks].reverse().find((x) => x.task_key === taskKey);
      const state = currentState(paths, L);
      appendRunLog(paths, [taskKey, tk.agent, maxLevelOf(tk.allowed_levels), 'failed', `${state} -> ${state}`, logRel, killedReason]);
    }
    console.error(`${killedReason}${taskKey ? ` ${taskKey} recorded as failed.` : ''}`);
    return EXIT.TIMEOUT;
  }
  console.log(`process ${child.pid}: ${status}${Number.isInteger(code) ? ` (exit ${code})` : signal ? ' (signal)' : ''}`);
  return Number.isInteger(code) ? code : EXIT.ERROR;
}

/* ---------------------------------------------------------------- gates */

const GATE_INPUT = ['gate_key', 'gate_kind', 'level', 'question', 'why_now', 'exact_action', 'options', 'recommended_option',
  'recommended_reason', 'verified_evidence', 'not_verified', 'risks', 'requested_at', 'expires_at', 'expires_in_days', 'supersedes_gate_key'];

// Validates a packet the way the Control Room will, and refuses (before anything is written) an L4
// gate that is not a pure handoff.
export function buildGate(input, { project, now = new Date(), existing = () => false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) usage('The gate packet must be a JSON object.');
  for (const k of Object.keys(input)) if (!GATE_INPUT.includes(k)) usage(`Unknown gate field: ${k.slice(0, 40)}.`);
  const day = nowIso(now).slice(0, 10);
  const g = {};
  g.gate_key = input.gate_key ? keyed('gate_key', input.gate_key, KEY_PATTERNS.gate) : null;
  g.gate_kind = oneOf('gate_kind', input.gate_kind, GATE_KINDS);
  g.level = oneOf('level', input.level, LEVELS);
  g.question = safeText('question', input.question, { max: 400, required: true });
  g.why_now = safeText('why_now', input.why_now, { max: 600, required: true });
  g.exact_action = safeText('exact_action', input.exact_action, { max: 600, required: true });
  if (!Array.isArray(input.options) || !input.options.length || input.options.length > 6) usage('options must list 1 to 6 options.');
  g.options = input.options.map((o, i) => {
    if (!o || typeof o !== 'object') usage(`options[${i}] must be an object.`);
    for (const k of Object.keys(o)) if (!['key', 'label', 'consequence', 'authorizes'].includes(k)) usage(`Unknown option field: ${k.slice(0, 40)}.`);
    if (o.authorizes !== undefined && typeof o.authorizes !== 'boolean') usage(`options[${i}].authorizes must be true or false.`);
    return { key: keyed(`options[${i}].key`, o.key, KEY_PATTERNS.optionKey), label: safeText(`options[${i}].label`, o.label, { max: 80, required: true }),
      consequence: safeText(`options[${i}].consequence`, o.consequence, { max: 300, required: true }), authorizes: o.authorizes === true };
  });
  const keys = g.options.map((o) => o.key);
  if (new Set(keys).size !== keys.length) usage('Option keys must be unique.');
  // L4 is never autonomous: only a handoff to a person, with nothing a bot could act on.
  if ((g.level === 'L4') !== (g.gate_kind === 'l4_handoff')) refuse('An L4 gate must be gate_kind l4_handoff, and only an L4 gate may be l4_handoff. Nothing was written.');
  if (g.level === 'L4' && g.options.some((o) => !L4_OPTION_KEYS.includes(o.key) || o.authorizes)) {
    refuse('An L4 gate may offer only done_by_human, not_doing and deferred, and none of them may authorize anything. Nothing was written.');
  }
  if (g.gate_kind === 'l3_approval' && g.level !== 'L3') refuse('An l3_approval gate must be level L3. Nothing was written.');
  g.recommended_option = input.recommended_option ? keyed('recommended_option', input.recommended_option, KEY_PATTERNS.optionKey) : null;
  if (g.recommended_option && !keys.includes(g.recommended_option)) usage('recommended_option must be one of the option keys.');
  g.recommended_reason = safeText('recommended_reason', input.recommended_reason, { max: 300 });
  for (const f of ['verified_evidence', 'not_verified', 'risks']) {
    const v = input[f] ?? [];
    if (!Array.isArray(v) || v.length > 20) usage(`${f} must be a list of at most 20 items.`);
    g[f] = v.map((x, i) => safeText(`${f}[${i}]`, x, { max: 300, required: true }));
  }
  const time = (name, v) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(String(v)) || Number.isNaN(Date.parse(v))) usage(`${name} must be an ISO time with a zone.`);
    return new Date(v).toISOString();
  };
  g.requested_at = input.requested_at ? time('requested_at', input.requested_at) : nowIso(now);
  const days = input.expires_in_days ?? 7;
  if (!Number.isFinite(days) || days <= 0 || days > GATE_MAX_DAYS) usage(`expires_in_days must be more than 0 and at most ${GATE_MAX_DAYS}.`);
  g.expires_at = input.expires_at ? time('expires_at', input.expires_at) : new Date(Date.parse(g.requested_at) + days * 86400000).toISOString();
  const span = Date.parse(g.expires_at) - Date.parse(g.requested_at);
  if (span <= 0 || span > GATE_MAX_DAYS * 86400000) usage(`A gate must expire after it is asked and within ${GATE_MAX_DAYS} days.`);
  if (!g.gate_key) {
    let n = 1;
    const base = `G-${day}-${String(project ?? 'gate').slice(0, 30).replace(/-+$/, '')}-`;
    while (existing(`${base}${String(n).padStart(2, '0')}`)) n += 1;
    g.gate_key = `${base}${String(n).padStart(2, '0')}`;
  }
  const supersedes = input.supersedes_gate_key ? keyed('supersedes_gate_key', input.supersedes_gate_key, KEY_PATTERNS.gate) : null;
  if (supersedes && !existing(supersedes)) usage('supersedes_gate_key names a gate that does not exist in .jmw/gates/.');
  if (supersedes === g.gate_key) usage('A gate cannot supersede itself.');
  const packet = packetOf(g);
  return { ...packet, supersedes_gate_key: supersedes, status: 'open', packet_hash: packetHash(packet) };
}

function cmdGateRaise(paths, flags) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const from = flags.from;
  if (!from || from === true) usage('--from <file.json> is required (use - for standard input).');
  let input;
  try { input = JSON.parse(from === '-' ? readFileSync(0, 'utf8') : readFileSync(String(from), 'utf8')); }
  catch { usage('The gate packet file could not be read as JSON.'); }
  const L0 = readLedger(paths, runKey);
  runningRun(L0);
  mkdirSync(paths.gates, { recursive: true });
  const file = (k) => join(paths.gates, `${k}.json`);
  const gate = buildGate(input, { project: L0.project, existing: (k) => existsSync(file(k)) });
  if (existsSync(file(gate.gate_key))) refuse(`${gate.gate_key} already exists. Gates are never edited: raise a new gate with supersedes_gate_key.`);
  try { writeFileSync(file(gate.gate_key), `${JSON.stringify(gate, null, 2)}\n`, { flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') refuse(`${gate.gate_key} already exists.`); throw e; }
  updateLedger(paths, runKey, (L) => { if (!L.gates.includes(gate.gate_key)) L.gates.push(gate.gate_key); L.run.last_progress_at = nowIso(); return L; });
  say(`GATE ${gate.gate_key} (${gate.level}, ${gate.gate_kind}) written to .jmw/gates/${gate.gate_key}.json`, `packet_hash ${gate.packet_hash}`,
    `expires ${gate.expires_at}`, '',
    'Only when Jana states her answer in the session, record it as a decision in .jmw/DECISIONS.md with her name as decided_by and these lines:',
    `- gate: ${gate.gate_key}`, `- gate_answer: <one of: ${gate.options.map((o) => o.key).join(', ')}>`, `- packet_hash: ${gate.packet_hash}`);
  return EXIT.OK;
}

const AI_NAME = /(claude|anthropic|openai|chatgpt|\bgpt|copilot|gemini|\bllm\b|assistant|\bbot\b|\bagent\b)/i;
const NOT_A_PERSON = /^(ai|system|none|unknown|tbd|n\/a|jmw-.*|\(.*\))$/i;

export function findGateAnswer(decisionsText, gateKey) {
  const text = String(decisionsText ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const found = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const h = /^###\s+(D-\d{1,6})\b/.exec(line);
    if (h) { cur = { key: h[1] }; found.push(cur); continue; }
    if (/^#{1,2}\s/.test(line)) { cur = null; continue; }
    const m = cur && /^\s*-\s+([a-z_]+)\s*:\s*(.*?)\s*$/i.exec(line);
    if (m && !(m[1].toLowerCase() in cur)) cur[m[1].toLowerCase()] = m[2];
  }
  return found.filter((d) => d.gate === gateKey && !/^D-0+$/.test(d.key)).at(-1) ?? null;
}

function cmdGateConsume(paths, flags, now = new Date()) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const gateKey = keyed('gate', flags.gate, KEY_PATTERNS.gate);
  const file = join(paths.gates, `${gateKey}.json`);
  if (!existsSync(file)) usage(`No gate packet .jmw/gates/${gateKey}.json.`);
  const gate = JSON.parse(readFileSync(file, 'utf8'));
  const hash = packetHash(gate);
  const d = findGateAnswer(existsSync(paths.decisions) ? readFileSync(paths.decisions, 'utf8') : '', gateKey);
  const no = (why) => refuse(`${gateKey} cannot be used: ${why} Do not act on it.`);
  if (gate.level === 'L4') no('it is an L4 handoff. A person does that action, never a bot.');
  if (gate.status === 'withdrawn') no('it was withdrawn.');
  if (!d) no('there is no decision for it in .jmw/DECISIONS.md.');
  if (String(d.status ?? '').toLowerCase() !== 'active') no(`decision ${d.key} is not active.`);
  if (!d.decided_by || NOT_A_PERSON.test(d.decided_by) || AI_NAME.test(d.decided_by)) no(`decision ${d.key} is not recorded as a person's.`);
  if (String(d.packet_hash ?? '').toLowerCase() !== hash) no(`decision ${d.key} answers a different packet (hash mismatch).`);
  const option = gate.options.find((o) => o.key === String(d.gate_answer ?? '').toLowerCase());
  if (!option) no(`decision ${d.key} answer is not one of the gate's options.`);
  if (!option.authorizes) no(`the answer "${option.key}" does not authorize the action.`);
  if (now.getTime() >= Date.parse(gate.expires_at)) no('it has expired. Raise a new gate.');
  if (/^\d{4}-\d{2}-\d{2}/.test(d.date ?? '') && d.date.slice(0, 10) < gate.requested_at.slice(0, 10)) no(`decision ${d.key} is dated before the gate was asked.`);
  const used = listLedgers(paths).some((L) => (L.gate_consumptions ?? []).some((c) => c.gate_key === gateKey));
  if (used) no('it was already used once.');
  updateLedger(paths, runKey, (L) => {
    runningRun(L);
    if (levelRank(gate.level) > levelRank(L.run.max_level)) no(`it is ${gate.level} and this run allows at most ${L.run.max_level}.`);
    L.gate_consumptions.push({ gate_key: gateKey, consumed_at: nowIso(now) });
    L.run.last_progress_at = nowIso(now);
    return L;
  });
  say(`GATE ${gateKey} used once by ${runKey}: answer "${option.key}" (${d.key}, decided by a person). Do exactly: ${gate.exact_action}`);
  return EXIT.OK;
}

/* ------------------------------------------------------ artifacts, feedback */

function cmdArtifact(paths, flags) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const kind = oneOf('kind', flags.kind, ARTIFACT_KINDS);
  const taskKey = keyed('task-key', flags['task-key'], KEY_PATTERNS.task, { required: false });
  const issue = keyed('issue', flags.issue, KEY_PATTERNS.issue, { required: false });
  const checked = flagBool(flags['sensitive-checked'], 'sensitive-checked');
  if (checked === null) usage('--sensitive-checked yes|no is required: say whether someone checked it for private data.');
  let a;
  if (flags.url) {
    const url = String(flags.url);
    if (!/^https:\/\/[^/@?#\s]+(\/[^?#\s]*)?$/.test(url) || url.length > 400) usage('--url must be https with no credentials, query or fragment.');
    a = { kind, location_kind: 'url', path_or_url: url };
  } else {
    const rel = relPath('path', flags.path);
    const full = inside(paths.root, rel);
    let location = flags.location ? oneOf('location', flags.location, LOCATION_KINDS.filter((l) => l !== 'url')) : null;
    if (!location) {
      try { execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: paths.root, stdio: 'ignore', timeout: 5000 }); location = 'repo'; }
      catch { location = 'local_only'; }
    }
    a = { kind, location_kind: location, path_or_url: rel };
    if (existsSync(full) && statSync(full).isFile()) {
      const s = statSync(full);
      a.bytes = s.size;
      a.captured_at = new Date(s.mtimeMs).toISOString();
      if (s.size <= 256 * 1024 * 1024) a.sha256 = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
    if (location === 'repo' && flags.commit) a.commit_sha = keyed('commit', String(flags.commit).toLowerCase(), KEY_PATTERNS.sha);
  }
  if (/(^|\/)(\.env(\..*)?|[^/]*\.(pem|key|p12|pfx)|credentials[^/]*|secrets[^/]*)$/i.test(a.path_or_url)) refuse('That artifact looks like a credential file. Nothing was written.');
  safeText('artifact location', a.path_or_url, { max: 400 });
  updateLedger(paths, runKey, (L) => {
    const t = taskOf(L, taskKey);
    L.artifacts.push({ ...a, task_key: taskKey, task_attempt: t?.attempt ?? null, issue_key: issue, captured_at: a.captured_at ?? nowIso(), sensitive_checked: checked });
    return L;
  });
  say(`artifact recorded: ${a.kind} ${a.path_or_url}`);
  return EXIT.OK;
}

function cmdFeedback(paths, flags) {
  const runKey = keyed('run', flags.run, KEY_PATTERNS.run);
  const slug = keyed('slug', flags.slug, /^[a-z0-9][a-z0-9-]{0,40}$/);
  const component = oneOf('component', flags.component, FEEDBACK_COMPONENTS);
  const severity = oneOf('severity', flags.severity, FEEDBACK_SEVERITIES);
  const description = safeText('--description', flags.description, { max: 1000, required: true });
  const ref = safeText('--ref', flags.ref, { max: 120 });
  let key;
  updateLedger(paths, runKey, (L) => {
    key = `FF-${L.project}-${slug}`.slice(0, 65).replace(/[-.]+$/, '');
    if (!KEY_PATTERNS.feedback.test(key)) usage('Feedback key would be invalid: use a shorter --slug.');
    if (L.framework_feedback.some((f) => f.feedback_key === key)) refuse(`${key} is already recorded in this run.`);
    L.framework_feedback.push({ feedback_key: key, component, component_ref: ref, severity, description, status: 'open', observed_at: nowIso() });
    return L;
  });
  say(`FEEDBACK ${key} (${severity}, ${component}) recorded. It reaches Bot Ops with the next report.`,
    'The fix belongs in jmw-bot-team (open an issue there). It is never made from the Control Room or patched locally in this project.');
  return EXIT.OK;
}

function cmdResumeCheck(paths, flags) {
  requireJmw(paths);
  const r = analyseResume(paths);
  if (flags.json) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return r.crash_loop ? EXIT.CRASH_LOOP : EXIT.OK; }
  const out = [`latest run: ${r.latest_run ?? 'none'}`];
  if (!r.interrupted_run) out.push('No interrupted run: a new run starts fresh.');
  else {
    out.push(`${r.interrupted_run} has RUN-START and no RUN-END: INTERRUPTED. A new run will resume from it.`);
    for (const t of r.unfinished_tasks) out.push(`  task ${t.task_key} attempt ${t.attempt} (${t.top_level})${levelRank(t.top_level) >= 2 ? ': verify its effect before any retry' : ''}`);
    for (const p of r.processes) out.push(`  process ${p.pid} (${p.kind}, ${p.label}): ${p.alive ? 'still running (orphan)' : 'gone'}`);
  }
  if (r.crash_loop) out.push(`CRASH LOOP: ${r.runs_interrupted.join(', ')} ended interrupted in a row. The next start will end blocked, not retry.`);
  say(...out);
  return r.crash_loop ? EXIT.CRASH_LOOP : EXIT.OK;
}

/* ----------------------------------------------------------------- main */

const COMMANDS = { start: cmdStart, end: cmdEnd, 'task-start': cmdTaskStart, 'task-end': cmdTaskEnd, step: cmdStep, heartbeat: cmdStep,
  'proc-register': cmdProcRegister, 'proc-end': cmdProcEnd, 'proc-cleanup': cmdProcCleanup, 'gate-raise': cmdGateRaise,
  'gate-consume': cmdGateConsume, artifact: cmdArtifact, feedback: cmdFeedback, 'resume-check': cmdResumeCheck };

export async function main(argv) {
  const [command, ...restArgs] = argv;
  const { flags, rest } = parseArgs(restArgs);
  const paths = projectPaths(flags['project-root']);
  if (command === 'spawn' || command === 'spawn-with-timeout') {
    requireJmw(paths);
    return spawnWithBudget(paths, flags, rest[0], rest.slice(1));
  }
  const fn = COMMANDS[command];
  if (!fn) usage(`usage: node jmw-run.mjs <${[...Object.keys(COMMANDS), 'spawn'].join('|')}> --project-root <dir> [options]`);
  requireJmw(paths);
  if (rest.length) usage('Unexpected extra arguments.');
  return fn(paths, flags);
}

if (isMain(import.meta.url)) runCli(main);
