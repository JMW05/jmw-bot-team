// Run boundaries, resume semantics, blind-retry refusal, crash loop, processes, feedback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isAlive, readRuns, projectPaths } from '../../scripts/jmw-lib.mjs';
import { jmwRun, ledger, makeProject, runKeyFrom, runLog } from './helpers.mjs';

const start = (root, extra = []) => {
  const r = jmwRun(root, 'start', ['--mode', 'GAME_BUILD', '--target', 'GAME_QA', ...extra]);
  return { ...r, key: runKeyFrom(r.stdout) ?? runKeyFrom(r.stderr) };
};
const taskStart = (root, run, key, levels = 'L0,L1', extra = []) =>
  jmwRun(root, 'task-start', ['--run', run, '--task-key', key, '--agent', 'game-builder', '--goal', 'Integrate frames', '--levels', levels, ...extra]);

test('start writes RUN-START with a stable run key and a ledger; end writes RUN-END', (t) => {
  const root = makeProject(t);
  const a = start(root);
  assert.equal(a.code, 0, a.out);
  assert.match(a.key, /^R-\d{4}-\d{2}-\d{2}-tales-from-the-crue-01$/);
  const L = ledger(root, a.key);
  assert.equal(L.run.status, 'running');
  assert.equal(L.run.max_level, 'L1', 'GAME_BUILD allows at most L1');
  assert.equal(L.run.state_at_start, 'VERTICAL_SLICE', 'state read from STATUS.md');
  assert.match(runLog(root), new RegExp(`\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} Z \\| RUN-START \\| ${a.key} \\| jmw-project-manager \\| GAME_BUILD \\| game \\| VERTICAL_SLICE -> GAME_QA \\| resumed_from: none`));
  const e = jmwRun(root, 'end', ['--run', a.key, '--status', 'stopped-human-gate', '--state', 'GAME_QA', '--reason', 'art direction gate open']);
  assert.equal(e.code, 0, e.out);
  assert.match(runLog(root), new RegExp(`\\| RUN-END \\| ${a.key} \\| stopped-human-gate \\| GAME_QA \\| art direction gate open`));
  const L2 = ledger(root, a.key);
  assert.equal(L2.run.status, 'stopped_human_gate');
  assert.ok(L2.run.finished_at && L2.run.last_progress_at);
  assert.notEqual(jmwRun(root, 'end', ['--run', a.key, '--status', 'failed', '--reason', 'x']).code, 0, 'an ended run cannot end again');
  const b = start(root);
  assert.match(b.key, /-02$/, 'NN increments');
  assert.equal(ledger(root, b.key).run.resumed_from_run_key, null, 'previous run ended: fresh start');
});

test('mode limits: L4 never, levels above the run refused, budget enforced', (t) => {
  const root = makeProject(t);
  assert.equal(jmwRun(root, 'start', ['--mode', 'GAME_BUILD', '--max-level', 'L4']).code, 5);
  assert.equal(jmwRun(root, 'start', ['--mode', 'REVIEW', '--max-level', 'L2']).code, 5, 'REVIEW is L0');
  const a = start(root, ['--task-budget', '2']);
  assert.equal(taskStart(root, a.key, 'T-a1', 'L0,L4').code, 5, 'L4 task refused');
  assert.equal(taskStart(root, a.key, 'T-a1', 'L0,L2').code, 5, 'L2 task in an L1 run refused');
  assert.equal(taskStart(root, a.key, 'T-a1').code, 0);
  assert.equal(taskStart(root, a.key, 'T-a1').code, 5, 'same task still running');
  assert.equal(jmwRun(root, 'task-end', ['--run', a.key, '--task-key', 'T-a1', '--status', 'done', '--summary', 'ok']).code, 0);
  assert.equal(taskStart(root, a.key, 'T-a2').code, 0);
  const over = taskStart(root, a.key, 'T-a3');
  assert.equal(over.code, 5);
  assert.match(over.out, /budget/);
});

test('task-end appends one RUN-LOG step line and updates last_progress_at; secrets and paths refused', (t) => {
  const root = makeProject(t);
  const a = start(root);
  taskStart(root, a.key, 'T-b1');
  const before = ledger(root, a.key).run.last_progress_at;
  const bad = jmwRun(root, 'task-end', ['--run', a.key, '--task-key', 'T-b1', '--status', 'done', '--summary', 'used token=abcdef123456']);
  assert.equal(bad.code, 5);
  assert.doesNotMatch(bad.out, /abcdef123456/, 'the value is never echoed');
  assert.equal(jmwRun(root, 'task-end', ['--run', a.key, '--task-key', 'T-b1', '--status', 'done', '--summary', 'see /home/jana/x']).code, 5);
  const ok = jmwRun(root, 'task-end', ['--run', a.key, '--task-key', 'T-b1', '--status', 'done', '--summary', 'Frames integrated',
    '--states', 'VERTICAL_SLICE -> GAME_QA', '--evidence', '.jmw/artifacts/evidence/x.txt']);
  assert.equal(ok.code, 0, ok.out);
  assert.match(runLog(root), /\| T-b1 \| game-builder \| L1 \| done \| VERTICAL_SLICE -> GAME_QA \| \.jmw\/artifacts\/evidence\/x\.txt \| Frames integrated/);
  assert.ok(ledger(root, a.key).run.last_progress_at >= before);
  assert.equal(jmwRun(root, 'task-end', ['--run', a.key, '--task-key', 'T-b1', '--status', 'done']).code, 0, 'same status again is a no-op');
  assert.equal(jmwRun(root, 'task-end', ['--run', a.key, '--task-key', 'T-b1', '--status', 'failed']).code, 5, 'a finished task is not rewritten');
  const hb = jmwRun(root, 'step', ['--run', a.key, '--note', 'routed QA']);
  assert.equal(hb.code, 0, hb.out);
  assert.match(runLog(root), /\| - \| jmw-project-manager \| L0 \| done \| .* \| none \| routed QA/);
});

test('RUN-START without RUN-END is interrupted: next run resumes, tasks interrupted, no blind L2 retry', (t) => {
  const root = makeProject(t, { workflow: 'website', state: 'QA', mode: 'STAGING', slug: 'lavish' });
  const a = jmwRun(root, 'start', ['--mode', 'STAGING']);
  const r1 = runKeyFrom(a.stdout);
  assert.equal(taskStart(root, r1, 'T-c1', 'L0,L1,L2').code, 0);
  assert.equal(taskStart(root, r1, 'T-c2', 'L0').code, 0);
  // the session dies here: no task-end, no RUN-END
  const check = jmwRun(root, 'resume-check');
  assert.equal(check.code, 0);
  assert.match(check.out, new RegExp(`${r1} has RUN-START and no RUN-END: INTERRUPTED`));
  const b = jmwRun(root, 'start', ['--mode', 'STAGING']);
  assert.equal(b.code, 0, b.out);
  const r2 = runKeyFrom(b.stdout);
  assert.match(b.out, /T-c1 attempt 1 \(L2\) - L2\+: verify/);
  assert.match(runLog(root), new RegExp(`RUN-START \\| ${r2} .* \\| resumed_from: ${r1}`));
  assert.equal(ledger(root, r2).run.resumed_from_run_key, r1);
  const old = ledger(root, r1);
  assert.equal(old.run.status, 'interrupted');
  assert.ok(old.run.finished_at);
  assert.deepEqual(old.tasks.map((x) => x.status), ['interrupted', 'interrupted']);
  // L0/L1 may simply be re-run
  assert.equal(taskStart(root, r2, 'T-c2', 'L0').code, 0);
  assert.equal(ledger(root, r2).tasks[0].attempt, 2);
  assert.equal(ledger(root, r2).tasks[0].prior_attempt_effect, 'not_applicable');
  // L2+ never blind
  const blind = taskStart(root, r2, 'T-c1', 'L0,L1,L2');
  assert.equal(blind.code, 5);
  assert.match(blind.out, /Never retry it blind/);
  const verified = taskStart(root, r2, 'T-c1', 'L0,L1,L2', ['--prior-attempt-effect', 'verified_absent']);
  assert.equal(verified.code, 0, verified.out);
  const t1 = ledger(root, r2).tasks.find((x) => x.task_key === 'T-c1');
  assert.equal(t1.attempt, 2);
  assert.equal(t1.prior_attempt_effect, 'verified_absent');
  // RUN-LOG brackets read back the same way the Control Room reads them
  const runs = readRuns(projectPaths(root));
  assert.deepEqual(runs.map((r) => [r.run_key, r.ended, r.resumed_from]), [[r1, false, null], [r2, false, r1]]);
});

test('two interrupted runs in a row: the third ends RUN-END blocked and does not retry', (t) => {
  const root = makeProject(t);
  const r1 = start(root).key;
  const r2 = start(root).key; // r1 interrupted
  assert.equal(ledger(root, r2).run.resumed_from_run_key, r1);
  const third = start(root); // r2 interrupted too: crash loop
  assert.equal(third.code, 4, third.out);
  assert.match(third.out, /Crash loop/);
  const L = ledger(root, third.key);
  assert.equal(L.run.status, 'blocked');
  assert.equal(L.run.resumed_from_run_key, r2);
  assert.ok(L.run.finished_at);
  assert.match(runLog(root), new RegExp(`RUN-END \\| ${third.key} \\| blocked \\| VERTICAL_SLICE \\| Crash loop: ${r1} and ${r2}`));
  assert.equal(taskStart(root, third.key, 'T-d1').code, 5, 'a blocked run routes nothing');
  assert.equal(jmwRun(root, 'resume-check').code, 0, 'after the blocked RUN-END a person may start again');
});

test('processes: safe labels only, exit recording, orphan detection on resume, cleanup', async (t) => {
  const root = makeProject(t);
  const r1 = start(root).key;
  taskStart(root, r1, 'T-e1');
  for (const label of ['godot --headless', 'GODOT=1 run', 'C:\\Godot\\godot.exe', '/usr/bin/godot', '"quoted"', "it's", 'user@host']) {
    const r = jmwRun(root, 'proc-register', ['--run', r1, '--task-key', 'T-e1', '--kind', 'godot', '--label', label, '--pid', '4242']);
    assert.notEqual(r.code, 0, `label refused: ${label}`);
  }
  assert.equal(ledger(root, r1).processes.length, 0);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((r) => child.once('spawn', r));
  assert.equal(jmwRun(root, 'proc-register', ['--run', r1, '--task-key', 'T-e1', '--kind', 'node', '--label', 'Node helper', '--pid', String(child.pid)]).code, 0);
  assert.equal(jmwRun(root, 'proc-register', ['--run', r1, '--kind', 'ffmpeg', '--label', 'FFmpeg capture', '--pid', '999999']).code, 0);
  assert.equal(jmwRun(root, 'proc-end', ['--run', r1, '--pid', '999999', '--status', 'exited_error', '--exit-code', '1']).code, 0);
  const p0 = ledger(root, r1).processes;
  assert.equal(p0[0].status, 'running');
  assert.equal(p0[1].status, 'exited_error');
  assert.equal(p0[1].exit_code, 1);
  assert.ok(p0[1].ended_at);
  for (const p of p0) for (const k of Object.keys(p)) assert.ok(!['command', 'args', 'env', 'cwd', 'path'].includes(k));
  // crash, then resume: the helper is still alive with nobody owning it
  const b = start(root);
  assert.match(b.out, new RegExp(`process ${child.pid} \\(node, Node helper\\): STILL RUNNING`));
  const carried = ledger(root, b.key).processes.find((p) => p.pid === child.pid);
  assert.equal(carried.status, 'orphaned');
  assert.equal(carried.cleanup_required, true);
  assert.equal(carried.run_key, r1);
  const c = jmwRun(root, 'proc-cleanup', ['--run', b.key, '--pid', String(child.pid)]);
  assert.equal(c.code, 0, c.out);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(isAlive(child.pid), false, 'orphan really ended');
  const cleaned = ledger(root, b.key).processes.find((p) => p.pid === child.pid);
  assert.equal(cleaned.status, 'killed');
  assert.equal(cleaned.cleanup_required, false);
  assert.equal(cleaned.cleaned_up_by, 'jmw-project-manager');
});

test('end closes open work honestly: unfinished tasks interrupted, live processes orphaned', async (t) => {
  const root = makeProject(t);
  const r = start(root).key;
  taskStart(root, r, 'T-f1');
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((res) => child.once('spawn', res));
  jmwRun(root, 'proc-register', ['--run', r, '--task-key', 'T-f1', '--kind', 'node', '--label', 'Node helper', '--pid', String(child.pid)]);
  const e = jmwRun(root, 'end', ['--run', r, '--status', 'stopped-no-eligible-work', '--reason', 'nothing eligible']);
  assert.equal(e.code, 0);
  assert.match(e.out, /WARNING: task T-f1 had no task-end/);
  assert.match(e.out, /orphaned, cleanup required/);
  const L = ledger(root, r);
  assert.equal(L.tasks[0].status, 'interrupted');
  assert.equal(L.processes[0].status, 'orphaned');
});

test('framework feedback FF-<project>-<slug> and artifacts', (t) => {
  const root = makeProject(t);
  const r = start(root).key;
  const f = jmwRun(root, 'feedback', ['--run', r, '--slug', 'capture-watchdog', '--component', 'process_supervision', '--severity', 'high',
    '--description', 'Watchdog killed a capture that was still writing frames.', '--ref', 'jmw-run spawn']);
  assert.equal(f.code, 0, f.out);
  assert.match(f.out, /jmw-bot-team/);
  const fb = ledger(root, r).framework_feedback[0];
  assert.equal(fb.feedback_key, 'FF-tales-from-the-crue-capture-watchdog');
  assert.equal(fb.status, 'open');
  assert.equal(jmwRun(root, 'feedback', ['--run', r, '--slug', 'capture-watchdog', '--component', 'pm_loop', '--severity', 'low', '--description', 'x']).code, 5);
  assert.equal(jmwRun(root, 'artifact', ['--run', r, '--kind', 'log', '--path', '.env', '--sensitive-checked', 'yes']).code, 5);
  assert.notEqual(jmwRun(root, 'artifact', ['--run', r, '--kind', 'log', '--path', '../outside.txt', '--sensitive-checked', 'yes']).code, 0);
  assert.notEqual(jmwRun(root, 'artifact', ['--run', r, '--kind', 'report', '--url', 'https://example.com/r?token=1', '--sensitive-checked', 'yes']).code, 0);
  assert.equal(jmwRun(root, 'artifact', ['--run', r, '--kind', 'report', '--path', '.jmw/STATUS.md', '--sensitive-checked', 'yes']).code, 0);
  const a = ledger(root, r).artifacts[0];
  assert.equal(a.location_kind, 'local_only', 'not tracked by git');
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!readdirSync(join(root, '.jmw', 'runs')).some((f2) => f2.endsWith('.tmp') || f2 === '.lock'), 'no lock or temp files left behind');
});
