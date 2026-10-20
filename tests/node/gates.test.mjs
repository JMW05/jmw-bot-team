// Human-gate packets: immutable files, golden hash, L4 refusal before writing, one-time consumption.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { packetHash } from '../../scripts/jmw-lib.mjs';
import { jmwRun, ledger, makeProject, runKeyFrom, tempDir } from './helpers.mjs';

// Golden value, computed once with the Control Room's canonical.mjs packetHash for this packet.
const GOLDEN_PACKET = { gate_key: 'G-2026-10-20-art', gate_kind: 'visual_review', level: 'L1', question: 'Approve the pose set?',
  why_now: 'QA matched 11 of 12 frames.', exact_action: 'Mark the 12-frame set as approved art direction.',
  options: [{ key: 'approve_set', label: 'Approve set', consequence: 'Builder keeps the set.', authorizes: true },
    { key: 'defer', label: 'Decide later', consequence: 'Run stops.', authorizes: false }],
  recommended_option: 'approve_set', recommended_reason: null, verified_evidence: [], not_verified: ['Live play feel'], risks: [],
  requested_at: '2026-10-20T10:00:00.000Z', expires_at: '2026-10-27T10:00:00.000Z' };
const GOLDEN_HASH = '3e577773dfcf3a26215c43dbf40fc2a57de7ca58913ccbd5878e8f9caa2bb20e';

test('packet hash matches the Control Room golden value', () => {
  assert.equal(packetHash(GOLDEN_PACKET), GOLDEN_HASH);
  // absent lists and strings normalise the same way
  const { verified_evidence: _a, risks: _b, recommended_reason: _c, ...sparse } = GOLDEN_PACKET;
  assert.equal(packetHash(sparse), GOLDEN_HASH);
});

function setup(t, mode = 'GAME_BUILD', extra = []) {
  const root = makeProject(t);
  const r = runKeyFrom(jmwRun(root, 'start', ['--mode', mode, ...extra]).stdout);
  const dir = tempDir(t, 'jmw-gate-');
  const raise = (packet) => { const f = join(dir, `p${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify(packet)); return jmwRun(root, 'gate-raise', ['--run', r, '--from', f]); };
  return { root, r, raise };
}
const ART = { gate_key: 'G-2026-10-20-art', gate_kind: 'visual_review', level: 'L1', question: 'Approve the pose set?',
  why_now: 'QA matched 11 of 12 frames.', exact_action: 'Mark the 12-frame set as approved art direction.',
  options: GOLDEN_PACKET.options, recommended_option: 'approve_set', not_verified: ['Live play feel'],
  requested_at: '2026-10-20T10:00:00Z', expires_at: '2026-10-27T10:00:00Z' };

test('gate-raise writes an immutable packet with the golden hash and the DECISIONS lines', (t) => {
  const { root, r, raise } = setup(t);
  const g = raise(ART);
  assert.equal(g.code, 0, g.out);
  assert.match(g.out, new RegExp(`packet_hash ${GOLDEN_HASH}`));
  assert.match(g.out, /- gate: G-2026-10-20-art\n- gate_answer: <one of: approve_set, defer>\n- packet_hash: /);
  const file = JSON.parse(readFileSync(join(root, '.jmw', 'gates', 'G-2026-10-20-art.json'), 'utf8'));
  assert.equal(file.packet_hash, GOLDEN_HASH);
  assert.equal(file.status, 'open');
  assert.deepEqual(ledger(root, r).gates, ['G-2026-10-20-art']);
  const again = raise({ ...ART, question: 'Approve the pose set now?' });
  assert.equal(again.code, 5);
  assert.match(again.out, /never edited/);
  assert.equal(JSON.parse(readFileSync(join(root, '.jmw', 'gates', 'G-2026-10-20-art.json'), 'utf8')).packet_hash, GOLDEN_HASH, 'unchanged');
  const sup = raise({ ...ART, gate_key: 'G-2026-10-20-art-2', question: 'Approve the pose set now?', supersedes_gate_key: 'G-2026-10-20-art' });
  assert.equal(sup.code, 0, sup.out);
  const auto = raise({ ...ART, gate_key: undefined, requested_at: undefined, expires_at: undefined });
  assert.equal(auto.code, 0, auto.out);
  assert.match(auto.out, /GATE G-\d{4}-\d{2}-\d{2}-tales-from-the-crue-01 /);
});

test('L4 gates: refused before writing unless a pure handoff; never consumable', (t) => {
  const { root, r, raise } = setup(t);
  const l4 = { gate_key: 'G-dns', gate_kind: 'l4_handoff', level: 'L4', question: 'Point the domain at the new host?',
    why_now: 'Launch needs DNS.', exact_action: 'Jana changes the DNS record herself.',
    options: [{ key: 'done_by_human', label: 'Done', consequence: 'Jana did it.' }, { key: 'not_doing', label: 'Not doing', consequence: 'No change.' },
      { key: 'deferred', label: 'Later', consequence: 'Waits.' }] };
  const authorizing = raise({ ...l4, options: [...l4.options.slice(0, 2), { key: 'deferred', label: 'Later', consequence: 'Waits.', authorizes: true }] });
  assert.equal(authorizing.code, 5);
  assert.match(authorizing.out, /none of them may authorize/);
  assert.equal(raise({ ...l4, options: [{ key: 'approve', label: 'Approve', consequence: 'Bot changes DNS.' }] }).code, 5);
  assert.equal(raise({ ...l4, gate_kind: 'policy_decision' }).code, 5, 'L4 must be l4_handoff');
  assert.equal(raise({ ...l4, level: 'L3' }).code, 5, 'only L4 may be l4_handoff');
  assert.equal(existsSync(join(root, '.jmw', 'gates', 'G-dns.json')), false, 'nothing written');
  assert.equal(raise({ ...l4, expires_in_days: 31 }).code, 2, 'max 30 days');
  assert.equal(raise({ ...l4, question: 'Use password: hunter2hunter2?' }).code, 5, 'secret-like text refused');
  assert.equal(raise({ ...l4, command: 'x' }).code, 2, 'unknown field refused');
  assert.equal(raise(l4).code, 0);
  const hash = JSON.parse(readFileSync(join(root, '.jmw', 'gates', 'G-dns.json'), 'utf8')).packet_hash;
  appendFileSync(join(root, '.jmw', 'DECISIONS.md'), `\n### D-001 — DNS\n- date: 2026-10-20\n- decided_by: Jana\n- source: session\n- decision: done\n- status: active\n- gate: G-dns\n- gate_answer: done_by_human\n- packet_hash: ${hash}\n`);
  const c = jmwRun(root, 'gate-consume', ['--run', r, '--gate', 'G-dns']);
  assert.equal(c.code, 5);
  assert.match(c.out, /L4 handoff/);
  assert.deepEqual(ledger(root, r).gate_consumptions, []);
  assert.ok(readdirSync(join(root, '.jmw', 'gates')).every((f) => f.endsWith('.json')));
});

test('gate-consume: needs a person\'s active answer to this exact packet, authorizing, unexpired, once', (t) => {
  const now = Date.now();
  const { root, r, raise } = setup(t);
  const packet = { ...ART, gate_key: 'G-art', requested_at: new Date(now - 3600000).toISOString(), expires_at: new Date(now + 86400000).toISOString() };
  assert.equal(raise(packet).code, 0);
  const hash = JSON.parse(readFileSync(join(root, '.jmw', 'gates', 'G-art.json'), 'utf8')).packet_hash;
  const day = new Date(now).toISOString().slice(0, 10);
  const decision = (key, o) => `\n### ${key} — Art\n- date: ${day}\n- decided_by: ${o.by ?? 'Jana'}\n- source: session\n- decision: x\n- status: ${o.status ?? 'active'}\n- gate: G-art\n- gate_answer: ${o.answer ?? 'approve_set'}\n- packet_hash: ${o.hash ?? hash}\n`;
  const decisions = join(root, '.jmw', 'DECISIONS.md');
  const base = readFileSync(decisions, 'utf8');
  const consume = () => jmwRun(root, 'gate-consume', ['--run', r, '--gate', 'G-art']);
  assert.match(consume().out, /no decision/);
  writeFileSync(decisions, base + decision('D-001', { by: 'Claude' }));
  assert.match(consume().out, /not recorded as a person/);
  writeFileSync(decisions, base + decision('D-001', { hash: 'a'.repeat(64) }));
  assert.match(consume().out, /hash mismatch/);
  writeFileSync(decisions, base + decision('D-001', { answer: 'defer' }));
  assert.match(consume().out, /does not authorize/);
  writeFileSync(decisions, base + decision('D-001', { status: 'superseded' }));
  assert.match(consume().out, /not active/);
  writeFileSync(decisions, base + decision('D-001', {}));
  const ok = consume();
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /used once/);
  assert.deepEqual(ledger(root, r).gate_consumptions.map((c) => c.gate_key), ['G-art']);
  const twice = consume();
  assert.equal(twice.code, 5);
  assert.match(twice.out, /already used once/);
});

test('gate-consume: expired gates and gates above the run level are refused', (t) => {
  const { root, r, raise } = setup(t, 'REVIEW');
  const past = { ...ART, gate_key: 'G-old', requested_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-02T00:00:00Z' };
  assert.equal(raise(past).code, 0);
  const hash = JSON.parse(readFileSync(join(root, '.jmw', 'gates', 'G-old.json'), 'utf8')).packet_hash;
  appendFileSync(join(root, '.jmw', 'DECISIONS.md'), `\n### D-001 — Old\n- date: 2026-01-01\n- decided_by: Jana\n- source: session\n- decision: x\n- status: active\n- gate: G-old\n- gate_answer: approve_set\n- packet_hash: ${hash}\n`);
  assert.match(jmwRun(root, 'gate-consume', ['--run', r, '--gate', 'G-old']).out, /expired/);
  const now = Date.now();
  const cur = { ...ART, gate_key: 'G-now', requested_at: new Date(now - 60000).toISOString(), expires_at: new Date(now + 86400000).toISOString() };
  raise(cur);
  const h2 = JSON.parse(readFileSync(join(root, '.jmw', 'gates', 'G-now.json'), 'utf8')).packet_hash;
  appendFileSync(join(root, '.jmw', 'DECISIONS.md'), `\n### D-002 — Now\n- date: ${new Date(now).toISOString().slice(0, 10)}\n- decided_by: Jana\n- source: session\n- decision: x\n- status: active\n- gate: G-now\n- gate_answer: approve_set\n- packet_hash: ${h2}\n`);
  assert.match(jmwRun(root, 'gate-consume', ['--run', r, '--gate', 'G-now']).out, /this run allows at most L0/);
});
