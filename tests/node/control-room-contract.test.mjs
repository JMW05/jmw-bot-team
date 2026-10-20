// Cross-check against the Control Room (JMW05/byjmw-control-room): a report built by these scripts
// from a sample project must pass its validator, gate hashes must equal its canonical hash, RUN-LOG
// must parse with its parser, and the mirrored vocabularies must match.
// Needs a local checkout of that repo: JMW_CONTROL_ROOM_PATH, or a sibling folder byjmw-control-room.
// Skips with a clear message when it is absent. Read-only towards that repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from '../../scripts/jmw-lib.mjs';
import { buildReport } from '../../scripts/jmw-report.mjs';
import { jmwRun, makeProject, REPO, runKeyFrom, tempDir } from './helpers.mjs';

const CR = resolve(process.env.JMW_CONTROL_ROOM_PATH || join(REPO, '..', 'byjmw-control-room'));
const VALIDATE = join(CR, 'netlify', 'lib', 'bot-ops', 'validate.mjs');
const present = existsSync(VALIDATE);
const skip = present ? false : `Control Room checkout not found (looked for ${VALIDATE}); set JMW_CONTROL_ROOM_PATH to run this cross-check`;
const load = (f) => import(pathToFileURL(join(CR, 'netlify', 'lib', 'bot-ops', f)).href);

// A sample project with a resumed run, retried tasks, a real process, gates, an artifact,
// feedback, a consumed gate and capability state.
async function sampleProject(t) {
  const root = makeProject(t);
  const dir = tempDir(t, 'jmw-cr-');
  const r1 = runKeyFrom(jmwRun(root, 'start', ['--mode', 'GAME_BUILD', '--target', 'VISUAL_REVIEW']).stdout);
  jmwRun(root, 'task-start', ['--run', r1, '--task-key', 'T-2026-10-20-01', '--agent', 'game-builder', '--goal', 'Integrate frames', '--levels', 'L0,L1']);
  // run 1 dies; run 2 resumes it
  const r2 = runKeyFrom(jmwRun(root, 'start', ['--mode', 'GAME_BUILD', '--target', 'VISUAL_REVIEW']).stdout);
  jmwRun(root, 'task-start', ['--run', r2, '--task-key', 'T-2026-10-20-01', '--agent', 'game-builder', '--goal', 'Integrate frames', '--levels', 'L0,L1',
    '--capabilities', 'game_qa', '--prohibited', 'export,release']);
  const sp = jmwRun(root, 'spawn', ['--run', r2, '--task-key', 'T-2026-10-20-01', '--kind', 'node', '--label', 'Node build helper', '--quiet', '--',
    process.execPath, '-e', 'console.log("built")']);
  assert.equal(sp.code, 0, sp.out);
  jmwRun(root, 'task-end', ['--run', r2, '--task-key', 'T-2026-10-20-01', '--status', 'done', '--summary', 'Frames integrated', '--states', 'VERTICAL_SLICE -> GAME_QA']);
  jmwRun(root, 'task-start', ['--run', r2, '--task-key', 'T-2026-10-20-02', '--agent', 'game-qa', '--goal', 'Independent QA', '--levels', 'L0']);
  jmwRun(root, 'artifact', ['--run', r2, '--kind', 'report', '--path', '.jmw/STATUS.md', '--task-key', 'T-2026-10-20-02', '--sensitive-checked', 'yes']);
  jmwRun(root, 'task-end', ['--run', r2, '--task-key', 'T-2026-10-20-02', '--status', 'stopped-human-gate', '--human-reason', 'art direction']);
  jmwRun(root, 'feedback', ['--run', r2, '--slug', 'resume-note', '--component', 'pm_loop', '--severity', 'low', '--description', 'Resume worked as designed.']);
  const now = Date.now();
  const gate = (o) => { const f = join(dir, `${o.gate_key}.json`); writeFileSync(f, JSON.stringify(o)); return jmwRun(root, 'gate-raise', ['--run', r2, '--from', f]); };
  const art = { gate_key: 'G-art', gate_kind: 'visual_review', level: 'L1', question: 'Approve the pose set?', why_now: 'QA matched 11 of 12 frames.',
    exact_action: 'Mark the set as approved art direction.', recommended_option: 'approve', recommended_reason: 'Within reference ambiguity.',
    options: [{ key: 'approve', label: 'Approve', consequence: 'Builder keeps the set.', authorizes: true }, { key: 'rework', label: 'Rework', consequence: 'Frame 7 redrawn.' }],
    verified_evidence: ['.jmw/artifacts/screenshots/frames.png'], not_verified: ['Live play feel'], risks: ['Timing may need redoing.'],
    requested_at: new Date(now - 3600000).toISOString(), expires_in_days: 7 };
  assert.equal(gate(art).code, 0);
  assert.equal(gate({ gate_key: 'G-dns', gate_kind: 'l4_handoff', level: 'L4', question: 'Change DNS?', why_now: 'Launch.', exact_action: 'Jana edits DNS herself.',
    options: [{ key: 'done_by_human', label: 'Done', consequence: 'Done by Jana.' }, { key: 'not_doing', label: 'No', consequence: 'Nothing.' }, { key: 'deferred', label: 'Later', consequence: 'Waits.' }] }).code, 0);
  const hash = JSON.parse(readFileSync(join(root, '.jmw', 'gates', 'G-art.json'), 'utf8')).packet_hash;
  appendFileSync(join(root, '.jmw', 'DECISIONS.md'), `\n### D-001 — Approve pose set\n- date: ${new Date(now).toISOString().slice(0, 10)}\n- decided_by: Jana\n- source: Claude Code session\n- decision: Approved the set.\n- scope: this project\n- supersedes: none\n- status: active\n- gate: G-art\n- gate_answer: approve\n- packet_hash: ${hash}\n`);
  assert.equal(jmwRun(root, 'gate-consume', ['--run', r2, '--gate', 'G-art']).code, 0);
  // an orphan from run 2 would need a live pid; register one and end it again
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'ignore' });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((r) => child.once('spawn', r));
  jmwRun(root, 'proc-register', ['--run', r2, '--kind', 'node', '--label', 'Dev helper', '--pid', String(child.pid), '--ports', '5173']);
  jmwRun(root, 'proc-cleanup', ['--run', r2, '--pid', String(child.pid)]);
  const caps = join(dir, 'capabilities.json');
  writeFileSync(caps, JSON.stringify({ schema_version: 1, generated_at: new Date(now - 600000).toISOString(), host: { os: 'Windows' },
    capabilities: { game_qa: { ready: true, missing: [] }, gameplay_capture: { ready: false, missing: ['local:ffmpeg'] } } }));
  return { root, r1, r2, caps };
}

test('reports built from a sample project pass the Control Room validator; hashes match', { skip }, async (t) => {
  const { validateReport, looksSecret } = await load('validate.mjs');
  const { packetHash } = await load('canonical.mjs');
  const { parseRunLog, parseDecisions, parseStatus } = await load('jmw-parse.mjs');
  const { root, r1, r2, caps } = await sampleProject(t);

  const report = buildReport({ projectRoot: root, runKey: r2, capabilities: caps });
  const v = validateReport(JSON.parse(JSON.stringify(report)));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(report.run.resumed_from_run_key, r1);
  assert.equal(report.gates.length, 2);
  for (const g of report.gates) assert.equal(g.packet_hash, packetHash(g), `hash parity ${g.gate_key}`);
  assert.equal(report.capabilities.items.length, 2);
  assert.ok(report.processes.length >= 2);
  assert.equal(report.gate_consumptions[0].gate_key, 'G-art');
  // the interrupted run's own ledger validates too
  const old = validateReport(JSON.parse(JSON.stringify(buildReport({ projectRoot: root, runKey: r1 }))));
  assert.equal(old.ok, true, JSON.stringify(old.errors));
  assert.equal(old.report.run.status, 'interrupted');

  // no secrets, no absolute paths, no temp folder anywhere in what is sent
  const json = JSON.stringify(report);
  assert.equal(looksSecret(json), false);
  assert.ok(!json.includes(root) && !json.includes(caps), 'no local paths');
  for (const p of report.processes) assert.ok(!/--|=|\/|\\|"|'/.test(p.label));

  // RUN-LOG, DECISIONS and STATUS parse with the Control Room parsers
  const log = parseRunLog(readFileSync(join(root, '.jmw', 'RUN-LOG.md'), 'utf8'));
  assert.deepEqual(log.errors, []);
  assert.deepEqual(log.parsed.runs.map((x) => [x.run_key, x.resumed_from, x.ended]), [[r1, null, false], [r2, r1, false]]);
  assert.deepEqual(log.parsed.open_run_keys, [r1, r2]);
  assert.ok(log.steps.every((s) => s.occurred_at), 'every step line has a zoned time');
  jmwRun(root, 'end', ['--run', r2, '--status', 'stopped-human-gate', '--reason', 'art gate answered; L4 DNS handoff open']);
  const ended = parseRunLog(readFileSync(join(root, '.jmw', 'RUN-LOG.md'), 'utf8'));
  assert.deepEqual(ended.errors, []);
  assert.equal(ended.parsed.runs[1].end_status, 'stopped_human_gate');
  assert.ok(validateReport(JSON.parse(JSON.stringify(buildReport({ projectRoot: root, runKey: r2 })))).ok);
  const dec = parseDecisions(readFileSync(join(root, '.jmw', 'DECISIONS.md'), 'utf8'));
  assert.deepEqual(dec.errors, []);
  assert.equal(dec.parsed.decisions[0].gate_packet_hash, report.gates.find((g) => g.gate_key === 'G-art').packet_hash);
  assert.equal(parseStatus(readFileSync(join(root, '.jmw', 'STATUS.md'), 'utf8')).status !== 'unreadable', true);
});

test('crash-loop run validates and is blocked', { skip }, async (t) => {
  const { validateReport } = await load('validate.mjs');
  const root = makeProject(t);
  jmwRun(root, 'start', ['--mode', 'GAME_BUILD']);
  jmwRun(root, 'start', ['--mode', 'GAME_BUILD']);
  const third = jmwRun(root, 'start', ['--mode', 'GAME_BUILD']);
  const key = runKeyFrom(third.stderr);
  const v = validateReport(JSON.parse(JSON.stringify(buildReport({ projectRoot: root, runKey: key }))));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.report.run.status, 'blocked');
});

test('mirrored vocabularies, key patterns and secret shapes match the Control Room', { skip }, async () => {
  const vocab = await load('vocab.mjs');
  const { looksSecret } = await load('validate.mjs');
  for (const name of ['LEVELS', 'BOT_LEVELS', 'WORKFLOWS', 'RUN_STATUSES', 'TASK_STATUSES', 'GATE_KINDS', 'L4_OPTION_KEYS', 'ARTIFACT_KINDS',
    'LOCATION_KINDS', 'PROCESS_KINDS', 'PROCESS_STATUSES', 'FEEDBACK_COMPONENTS', 'FEEDBACK_SEVERITIES']) {
    assert.deepEqual([...lib[name]], [...vocab[name]], name);
  }
  assert.equal(lib.GATE_MAX_DAYS, vocab.GATE_MAX_DAYS);
  for (const [k, re] of Object.entries(lib.KEY_PATTERNS)) assert.equal(re.source, vocab.KEY_PATTERNS[k].source, `pattern ${k}`);
  const samples = ['ghp_abcdefghijklmnopqrstuvwxyz1234', 'sk-abcdefghijklmnopqrstuvwxyz', 'postgres://u:p@h/db', 'token=abcdef123',
    'Bearer abcdefghijklmnopqrstuv', '-----BEGIN RSA PRIVATE KEY-----', 'plain words', 'Godot headless combat lab', 'https://example.com/a'];
  for (const s of samples) assert.equal(lib.looksSecret(s), looksSecret(s), s);
});

test('cross-check status', () => {
  if (!present) console.log(`# SKIPPED Control Room cross-check: ${skip}`);
  assert.ok(true);
});
