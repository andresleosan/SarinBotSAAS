import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('qa/source-restoration-r0');
mkdirSync(resolve(output, 'temp'), { recursive: true });
const cases = [
  { name: 'typecheck', args: ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'] },
  { name: 'vitest', args: ['qa/source-restoration-r0/run-vitest.mjs'] },
];
const records = [];
for (const entry of cases) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, entry.args, {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, CI: 'true', NO_COLOR: '1', NEXT_TELEMETRY_DISABLED: '1', TEMP: resolve(output, 'temp'), TMP: resolve(output, 'temp') },
  });
  writeFileSync(resolve(output, `${entry.name}.stdout.log`), result.stdout ?? '');
  writeFileSync(resolve(output, `${entry.name}.stderr.log`), result.stderr ?? '');
  records.push({ ...entry, executable: process.execPath, command: `node ${entry.args.join(' ')}`, startedAt, finishedAt: new Date().toISOString(), exitStatus: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: `qa/source-restoration-r0/${entry.name}.stdout.log`, stderr: `qa/source-restoration-r0/${entry.name}.stderr.log` });
  console.log(`${entry.name}: exit ${result.status}; stdout/stderr saved in qa/source-restoration-r0`);
  writeFileSync(resolve(output, 'baseline-commands.json'), JSON.stringify({ nodeVersion: process.version, packageManager: 'pnpm@11.23.0 required; pnpm absent from PATH; existing locked Node runners used without install', records }, null, 2) + '\n');
}
process.exitCode = records.some(record => record.exitStatus !== 0) ? 1 : 0;
