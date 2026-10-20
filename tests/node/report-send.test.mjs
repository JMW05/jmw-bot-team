// jmw-report: dry run by default; SEND only with --send, only to https (or a local mock), secret only
// from the environment and never printed. Every request here goes to a node:http server on 127.0.0.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkBody, ingestUrl, sendLoop, sendReport, buildReport } from '../../scripts/jmw-report.mjs';
import { FAKE_SECRET, jmwRun, makeProject, run, runAsync, runKeyFrom } from './helpers.mjs';

async function mockServer(t, respond = () => ({ status: 200, body: { status: 'ok', counts: { runs: 1, snapshots: 5, tasks: 0 }, warnings: [{ code: 'run_log_rewritten', ref: 'R-x' }] } })) {
  const hits = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, headers: req.headers, body });
      const r = respond(req);
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers ?? {}) });
      res.end(JSON.stringify(r.body ?? {}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { hits, url: `http://127.0.0.1:${server.address().port}/.netlify/functions/bot-ingest` };
}

function project(t) {
  const root = makeProject(t);
  const r = runKeyFrom(jmwRun(root, 'start', ['--mode', 'GAME_BUILD']).stdout);
  return { root, r };
}

test('dry run is the default: prints JSON, sends nothing', async (t) => {
  const { hits, url } = await mockServer(t);
  const { root, r } = project(t);
  const out = await runAsync('jmw-report.mjs', ['--project-root', root, '--run', r, '--url', url], { env: { CONTROL_ROOM_INGEST_SECRET: FAKE_SECRET } });
  assert.equal(out.code, 0, out.out);
  const report = JSON.parse(out.stdout);
  assert.equal(report.schema, 'jmw-report/1');
  assert.equal(report.run.run_key, r);
  assert.equal(hits.length, 0);
  assert.ok(!out.stdout.includes(FAKE_SECRET));
});

test('--send posts to the mock with the secret header and prints only status, counts and codes', async (t) => {
  const { hits, url } = await mockServer(t);
  const { root, r } = project(t);
  const out = await runAsync('jmw-report.mjs', ['--project-root', root, '--run', r, '--send', '--url', url], { env: { CONTROL_ROOM_INGEST_SECRET: FAKE_SECRET } });
  assert.equal(out.code, 0, out.out);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, 'POST');
  assert.equal(hits[0].headers['x-control-room-ingest-secret'], FAKE_SECRET);
  assert.equal(JSON.parse(hits[0].body).run.run_key, r);
  assert.ok(!hits[0].body.includes(FAKE_SECRET), 'secret never in the body');
  assert.equal(out.stdout.trim(), 'status 200; counts runs=1 snapshots=5; warnings run_log_rewritten');
  assert.ok(!out.out.includes(FAKE_SECRET));
  // the env var URL works too
  const viaEnv = await runAsync('jmw-report.mjs', ['--project-root', root, '--send'], { env: { CONTROL_ROOM_INGEST_SECRET: FAKE_SECRET, JMW_INGEST_URL: url } });
  assert.equal(viaEnv.code, 0, viaEnv.out);
  assert.equal(hits.length, 2);
});

test('a rejection prints status and codes only, exits non-zero', async (t) => {
  const { url } = await mockServer(t, () => ({ status: 422, body: { error: 'report_rejected', errors: [{ path: 'run.status', code: 'not_allowed' }], echoed: FAKE_SECRET } }));
  const { root, r } = project(t);
  const out = await runAsync('jmw-report.mjs', ['--project-root', root, '--run', r, '--send', '--url', url], { env: { CONTROL_ROOM_INGEST_SECRET: FAKE_SECRET } });
  assert.equal(out.code, 1);
  assert.equal(out.stdout.trim(), 'status 422; error report_rejected; errors not_allowed');
  assert.ok(!out.out.includes(FAKE_SECRET));
});

test('refusals happen before any network call', async (t) => {
  const { hits, url } = await mockServer(t);
  const { root, r } = project(t);
  const base = ['--project-root', root, '--run', r, '--send', '--url', url];
  const unset = await runAsync('jmw-report.mjs', base, { env: { CONTROL_ROOM_INGEST_SECRET: '' } });
  assert.equal(unset.code, 5);
  assert.match(unset.out, /CONTROL_ROOM_INGEST_SECRET is not set or is shorter than 32/);
  const short = await runAsync('jmw-report.mjs', base, { env: { CONTROL_ROOM_INGEST_SECRET: 'short-fake-value' } });
  assert.equal(short.code, 5);
  assert.ok(!short.out.includes('short-fake-value'), 'value never printed');
  const asArg = await runAsync('jmw-report.mjs', [...base, '--secret', FAKE_SECRET], { env: { CONTROL_ROOM_INGEST_SECRET: FAKE_SECRET } });
  assert.equal(asArg.code, 5);
  assert.match(asArg.out, /read only from the environment variable CONTROL_ROOM_INGEST_SECRET/);
  assert.ok(!asArg.out.includes(FAKE_SECRET));
  const noUrl = await runAsync('jmw-report.mjs', ['--project-root', root, '--send'], { env: { CONTROL_ROOM_INGEST_SECRET: FAKE_SECRET, JMW_INGEST_URL: '' } });
  assert.equal(noUrl.code, 2);
  assert.equal(hits.length, 0);
  // URL rules (checked without any request)
  assert.throws(() => ingestUrl('http://example.invalid/x'), /must be https/);
  assert.throws(() => ingestUrl('https://user:pw@example.invalid/x'), /credentials/);
  assert.throws(() => ingestUrl('https://example.invalid/x?k=v'), /query/);
  assert.equal(ingestUrl('https://byjmw-bot-ingest.netlify.app/.netlify/functions/bot-ingest').hostname, 'byjmw-bot-ingest.netlify.app');
  assert.equal(ingestUrl('http://localhost:9/x').hostname, 'localhost');
  // body rules
  assert.throws(() => checkBody('x'.repeat(1024 * 1024 + 1), FAKE_SECRET), /over the 1 MiB limit/);
  assert.throws(() => checkBody(`{"a":"${FAKE_SECRET}"}`, FAKE_SECRET), /ingest secret itself/);
  assert.throws(() => checkBody('{"a":"ghp_abcdefghijklmnopqrstuvwxyz123"}', FAKE_SECRET), /shaped like a credential/);
});

test('redirects are never followed (the secret header would travel with them)', async (t) => {
  const other = await mockServer(t);
  const { hits, url } = await mockServer(t, () => ({ status: 307, headers: { location: other.url }, body: {} }));
  const report = buildReport({ projectRoot: project(t).root });
  const r = await sendReport(report, { url, env: { CONTROL_ROOM_INGEST_SECRET: FAKE_SECRET } });
  assert.equal(r.ok, false);
  assert.equal(hits.length, 1);
  assert.equal(other.hits.length, 0);
  assert.ok(!r.summary.includes(FAKE_SECRET));
});

test('periodic send (heartbeat) repeats while the run is running and stops after it ends', async (t) => {
  const { hits, url } = await mockServer(t);
  const { root, r } = project(t);
  let n = 0;
  const logs = [];
  const last = await sendLoop(() => buildReport({ projectRoot: root, runKey: r }), {
    intervalMs: 1, maxMs: 60000, sendOptions: { url, env: { CONTROL_ROOM_INGEST_SECRET: FAKE_SECRET } }, log: (l) => logs.push(l),
    sleep: async () => { n += 1; if (n === 2) jmwRun(root, 'end', ['--run', r, '--status', 'succeeded']); },
  });
  assert.equal(last.ok, true);
  assert.equal(hits.length, 3, 'two while running, one final after RUN-END');
  assert.equal(JSON.parse(hits[2].body).run.status, 'succeeded');
  assert.ok(logs.every((l) => !l.includes(FAKE_SECRET)));
  const bad = run('jmw-report.mjs', ['--project-root', root, '--send', '--every-min', '0'], { env: { CONTROL_ROOM_INGEST_SECRET: FAKE_SECRET, JMW_INGEST_URL: url } });
  assert.equal(bad.code, 2, 'interval of at least 1 minute on the command line');
});
