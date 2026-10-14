import { copyFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Copy the single public illustration, never environment files or SaaS output.
await mkdir(resolve(root, 'landing/public/brand'), { recursive: true });
await copyFile(resolve(root, 'public/brand/sarin-welcome.png'), resolve(root, 'landing/public/brand/sarin-welcome.png'));

const child = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'build', 'landing'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
