// Resource preflight and child-process timeout budgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_THRESHOLDS, preflight, thresholdsFrom } from '../../scripts/jmw-preflight.mjs';
import { jmwRun, ledger, makeProject, run, runKeyFrom, runLog } from './helpers.mjs';

const probes = (o = {}) => ({ freeRamMb: () => 16000, totalRamMb: () => 32000, freeDiskMb: () => 200000, heavyRunning: () => [],
  tempDir: () => 'temp', ...o });

test('preflight: ok, warn, blocked, unknown never blocks', () => {
  assert.equal(preflight({ projectRoot: 'p', probes: probes() }).status, 'ok');
  const warn = preflight({ projectRoot: 'p', probes: probes({ freeRamMb: () => 3000 }) });
  assert.equal(warn.status, 'warn');
  const ram = preflight({ projectRoot: 'p', probes: probes({ freeRamMb: () => 900 }) });
  assert.equal(ram.status, 'blocked');
  assert.match(ram.reasons[0], /free RAM is 900 MB, below the 2048 MB minimum/);
  assert.match(ram.text, /NOT started/);
  const disk = preflight({ projectRoot: 'p', probes: probes({ freeDiskMb: (d) => (d === 'temp' ? 1000 : 200000) }) });
  assert.equal(disk.status, 'blocked');
  assert.match(disk.reasons[0], /temp drive/);
  const proj = preflight({ projectRoot: 'p', probes: probes({ freeDiskMb: (d) => (d === 'p' ? 4000 : 200000) }) });
  assert.match(proj.reasons[0], /project drive/);
  const heavy = preflight({ projectRoot: 'p', probes: probes({ heavyRunning: () => ['godot', 'ffmpeg'] }) });
  assert.equal(heavy.status, 'blocked');
  assert.match(heavy.reasons[0], /2 heavy programs are already running \(godot, ffmpeg\)/);
  assert.equal(preflight({ projectRoot: 'p', probes: probes({ heavyRunning: () => ['godot', 'ffmpeg'] }), countProcesses: false }).status, 'ok');
  const unknown = preflight({ projectRoot: 'p', probes: probes({ freeRamMb: () => { throw new Error('no'); }, heavyRunning: () => { throw new Error('no'); } }) });
  assert.equal(unknown.status, 'ok');
  assert.match(unknown.text, /not available/);
  assert.equal(preflight({ projectRoot: 'p', probes: probes({ freeRamMb: () => 1500 }), thresholds: { min_free_ram_mb: 1024, warn_free_ram_mb: 1024 } }).status, 'ok');
});

test('preflight thresholds: command line over .jmw/run-policy.json over defaults', () => {
  assert.deepEqual(thresholdsFrom({}, {}), {});
  assert.equal(thresholdsFrom({}, { preflight: { min_free_ram_mb: 3000 } }).min_free_ram_mb, 3000);
  assert.equal(thresholdsFrom({ 'min-free-ram-mb': '1000' }, { preflight: { min_free_ram_mb: 3000 } }).min_free_ram_mb, 1000);
  assert.equal(thresholdsFrom({ 'min-free-ram-mb': '8000' }, {}).warn_free_ram_mb, 8000, 'warning never below the minimum');
  assert.ok(DEFAULT_THRESHOLDS.min_free_ram_mb > 0 && DEFAULT_THRESHOLDS.max_heavy_running >= 1);
});

test('preflight CLI: refuses with exit 3, a plain reason, and a blocked task in the ledger', (t) => {
  const root = makeProject(t);
  const r = runKeyFrom(jmwRun(root, 'start', ['--mode', 'GAME_BUILD']).stdout);
  jmwRun(root, 'task-start', ['--run', r, '--task-key', 'T-p1', '--agent', 'game-qa', '--goal', 'Headless combat lab checks', '--levels', 'L0']);
  const ok = run('jmw-preflight.mjs', ['--project-root', root, '--min-free-ram-mb', '0', '--min-free-disk-mb', '0', '--min-free-temp-mb', '0', '--skip-process-count']);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /JMW resource preflight: (OK|WARN)/);
  const blocked = run('jmw-preflight.mjs', ['--project-root', root, '--run', r, '--task-key', 'T-p1', '--kind', 'godot', '--min-free-ram-mb', '99999999']);
  assert.equal(blocked.code, 3, blocked.out);
  assert.match(blocked.out, /BLOCKED[\s\S]*free RAM is .* below the .* minimum/);
  const L = ledger(root, r);
  assert.equal(L.tasks[0].status, 'blocked');
  assert.match(L.tasks[0].result_summary, /^Resource preflight refused heavy work: free RAM/);
  assert.equal(L.tasks[0].human_required, true);
  const ev = L.artifacts.find((a) => a.kind === 'evidence');
  assert.ok(ev && existsSync(join(root, ev.path_or_url)));
  assert.doesNotMatch(readFileSync(join(root, ev.path_or_url), 'utf8'), /[\\/](home|tmp|Users)[\\/]/, 'no paths in the evidence');
  assert.match(runLog(root), /\| T-p1 \| game-qa \| L0 \| blocked \| .* \| resource preflight refused heavy work/);
  const json = run('jmw-preflight.mjs', ['--project-root', root, '--json', '--min-free-disk-mb', '99999999']);
  assert.equal(json.code, 3);
  assert.equal(JSON.parse(json.stdout).status, 'blocked');
});

test('spawn: heavy kinds run the preflight first and start nothing when it refuses', (t) => {
  const root = makeProject(t);
  const r = runKeyFrom(jmwRun(root, 'start', ['--mode', 'GAME_BUILD']).stdout);
  jmwRun(root, 'task-start', ['--run', r, '--task-key', 'T-s1', '--agent', 'game-qa', '--goal', 'Big test run', '--levels', 'L0']);
  const s = jmwRun(root, 'spawn', ['--run', r, '--task-key', 'T-s1', '--kind', 'test_runner', '--label', 'Unit test run', '--min-free-temp-mb', '99999999',
    '--', process.execPath, '-e', 'require("fs").writeFileSync("SHOULD-NOT-EXIST","x")']);
  assert.equal(s.code, 3, s.out);
  assert.equal(existsSync(join(root, 'SHOULD-NOT-EXIST')), false, 'program was not started');
  const L = ledger(root, r);
  assert.equal(L.processes.length, 0);
  assert.equal(L.tasks[0].status, 'blocked');
});

test('spawn: a quiet program is ended at its budget and the task fails with the reason', (t) => {
  const root = makeProject(t);
  const r = runKeyFrom(jmwRun(root, 'start', ['--mode', 'GAME_BUILD']).stdout);
  jmwRun(root, 'task-start', ['--run', r, '--task-key', 'T-s2', '--agent', 'game-qa', '--goal', 'Headless run', '--levels', 'L0']);
  const t0 = Date.now();
  const s = jmwRun(root, 'spawn', ['--run', r, '--task-key', 'T-s2', '--kind', 'node', '--label', 'Quiet helper', '--timeout-sec', '2', '--stall-sec', '1',
    '--', process.execPath, '-e', 'setTimeout(() => {}, 60000)']);
  assert.equal(s.code, 124, s.out);
  assert.ok(Date.now() - t0 < 20000);
  const L = ledger(root, r);
  assert.equal(L.processes[0].status, 'killed');
  assert.ok(L.processes[0].ended_at);
  assert.equal(L.tasks[0].status, 'failed');
  assert.match(L.tasks[0].result_summary, /Quiet helper: Timed out after \d+ s with no new output/);
  assert.match(runLog(root), /\| T-s2 \| game-qa \| L0 \| failed \|/);
  assert.ok(!JSON.stringify(L).includes('setTimeout'), 'the command line is never recorded');
});

test('spawn: output progress earns more time up to the hard cap; a clean exit is exited_ok', (t) => {
  const root = makeProject(t);
  const r = runKeyFrom(jmwRun(root, 'start', ['--mode', 'GAME_BUILD']).stdout);
  jmwRun(root, 'task-start', ['--run', r, '--task-key', 'T-s3', '--agent', 'game-qa', '--goal', 'Capture', '--levels', 'L0']);
  // writes a line every 200 ms for ~3 s: past its 1 s budget, but never quiet, and under the 8 s cap
  const writer = 'let n=0;const i=setInterval(()=>{console.log("frame",++n);if(n>=15){clearInterval(i)}},200)';
  const s = jmwRun(root, 'spawn', ['--run', r, '--task-key', 'T-s3', '--kind', 'node', '--label', 'Frame writer', '--timeout-sec', '1', '--stall-sec', '1',
    '--max-sec', '8', '--quiet', '--', process.execPath, '-e', writer]);
  assert.equal(s.code, 0, s.out);
  assert.match(s.out, /still producing output/);
  const L = ledger(root, r);
  assert.equal(L.processes[0].status, 'exited_ok');
  assert.equal(L.processes[0].exit_code, 0);
  assert.equal(L.tasks[0].status, 'running', 'a clean exit leaves the task to the PM');
  const log = readFileSync(join(root, readdirLog(s.out)), 'utf8');
  assert.match(log, /frame 15/);
  // never quiet, but over the hard cap: ended
  jmwRun(root, 'task-start', ['--run', r, '--task-key', 'T-s4', '--agent', 'game-qa', '--goal', 'Capture', '--levels', 'L0']);
  const forever = 'setInterval(()=>console.log("frame"),100)';
  const c = jmwRun(root, 'spawn', ['--run', r, '--task-key', 'T-s4', '--kind', 'node', '--label', 'Endless writer', '--timeout-sec', '1', '--stall-sec', '1',
    '--max-sec', '2', '--quiet', '--', process.execPath, '-e', forever]);
  assert.equal(c.code, 124, c.out);
  assert.match(ledger(root, r).tasks[1].result_summary, /hard cap/);
  // a failing program is exited_error with its code
  const f = jmwRun(root, 'spawn', ['--run', r, '--kind', 'node', '--label', 'Failing helper', '--quiet', '--', process.execPath, '-e', 'process.exit(3)']);
  assert.equal(f.code, 3);
  assert.equal(ledger(root, r).processes.at(-1).status, 'exited_error');
  assert.equal(ledger(root, r).processes.at(-1).exit_code, 3);
});

function readdirLog(out) { return /log (\.jmw\/artifacts\/logs\/\S+\.log)/.exec(out)[1]; }

test('templates and installer stay in step with the scripts', async () => {
  const { REPO } = await import('./helpers.mjs');
  const { DEFAULT_TIMEOUTS_MIN, DEFAULT_STALL_MIN } = await import('../../scripts/jmw-run.mjs');
  const policy = JSON.parse(readFileSync(join(REPO, 'templates', 'jmw-state', 'run-policy.json'), 'utf8'));
  assert.deepEqual(policy.preflight, { ...DEFAULT_THRESHOLDS });
  assert.deepEqual(policy.timeouts_min, { ...DEFAULT_TIMEOUTS_MIN });
  assert.equal(policy.stall_min, DEFAULT_STALL_MIN);
  const installer = readFileSync(join(REPO, 'scripts', 'install-jmw-agents.ps1'), 'utf8');
  for (const f of ['jmw-lib.mjs', 'jmw-run.mjs', 'jmw-preflight.mjs', 'jmw-report.mjs', 'run-policy.json']) assert.ok(installer.includes(`'${f}'`), `installer copies ${f}`);
  const ignore = readFileSync(join(REPO, 'templates', 'jmw-state', '.gitignore'), 'utf8');
  for (const line of ['local/', '.env', '*.key', 'runs/.lock']) assert.ok(ignore.split(/\r?\n/).includes(line), `.jmw/.gitignore has ${line}`);
});
