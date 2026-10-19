// Test helpers: throwaway projects built from templates/jmw-state, and CLI runners.
// Everything happens in a fresh temp folder; nothing touches a real project or the network.
import { execFile, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCRIPTS = join(REPO, 'scripts');

export function tempDir(t, name = 'jmw-test-') {
  const dir = mkdtempSync(join(tmpdir(), name));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A project with fresh .jmw state files, as the installer would create them.
export function makeProject(t, { slug = 'tales-from-the-crue', workflow = 'game', state = 'VERTICAL_SLICE', mode = 'GAME_BUILD' } = {}) {
  const root = join(tempDir(t), 'project');
  mkdirSync(join(root, '.jmw'), { recursive: true });
  cpSync(join(REPO, 'templates', 'jmw-state'), join(root, '.jmw'), { recursive: true });
  const status = readFileSync(join(root, '.jmw', 'STATUS.md'), 'utf8')
    .replace('- project: (project slug, e.g. lavish)', `- project: ${slug}`)
    .replace(/- workflow: website\b/, `- workflow: ${workflow}`)
    .replace(/- current_state: INTAKE\b/, `- current_state: ${state}`)
    .replace(/- mode: REVIEW\b/, `- mode: ${mode}`);
  writeFileSync(join(root, '.jmw', 'STATUS.md'), status);
  return root;
}

export function run(script, args, { env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, input, timeout: 60000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}

// Async variant, needed when the test itself serves HTTP (spawnSync would block the server).
export function runAsync(script, args, { env = {} } = {}) {
  return new Promise((res) => {
    execFile(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 },
      (err, stdout, stderr) => res({ code: err ? err.code ?? 1 : 0, stdout, stderr, out: `${stdout}${stderr}` }));
  });
}

export const jmwRun = (root, cmd, args = [], opts) => run('jmw-run.mjs', [cmd, '--project-root', root, ...args], opts);
export const ledger = (root, runKey) => JSON.parse(readFileSync(join(root, '.jmw', 'runs', `${runKey}.json`), 'utf8'));
export const runLog = (root) => readFileSync(join(root, '.jmw', 'RUN-LOG.md'), 'utf8');
export const runKeyFrom = (out) => /RUN (R-\S+)/.exec(out)?.[1];

// An obviously fake ingest secret assembled at runtime (never a real credential).
export const FAKE_SECRET = ['test', 'only', 'not', 'a', 'real', 'secret', 'x'.repeat(12)].join('-');
