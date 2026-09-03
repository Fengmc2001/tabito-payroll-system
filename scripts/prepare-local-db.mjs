import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const wranglerEntry = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const statePath = String(process.env.PAYROLL_LOCAL_STATE_PATH || '.local/payroll-v2').trim();

if (!statePath) {
  throw new Error('PAYROLL_LOCAL_STATE_PATH cannot be empty.');
}

const result = spawnSync(process.execPath, [
  wranglerEntry,
  'd1',
  'migrations',
  'apply',
  'tabito-payroll-db',
  '--local',
  '--config',
  'wrangler.jsonc',
  '--persist-to',
  statePath,
], {
  cwd: projectRoot,
  // Wrangler skips its destructive-operation confirmation in CI mode. This
  // command only applies versioned migrations to the explicitly local D1.
  env: { ...process.env, CI: process.env.CI || 'true', WRANGLER_SEND_METRICS: 'false' },
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
