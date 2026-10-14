import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh';
describe.skipIf(!existsSync(shell))('Mac Ollama launcher with simulated binaries only', () => {
  let fixture: string;
  const launcher = resolve('deploy/macos/serve-ollama.sh');
  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), 'sarin-ollama-launcher-'));
    writeFileSync(join(fixture, 'uname'), '#!/bin/sh\nprintf \'%s\\n\' Darwin\n');
    writeFileSync(join(fixture, 'ollama'), '#!/bin/sh\nprintf "host=%s cloud=%s secret=%s argument=%s\\n" "$OLLAMA_HOST" "$OLLAMA_NO_CLOUD" "${SENSITIVE_TEST_VALUE-absent}" "$1"\n');
    chmodSync(join(fixture, 'uname'), 0o755);
    chmodSync(join(fixture, 'ollama'), 0o755);
  });
  afterAll(() => {
    if (fixture && dirname(resolve(fixture)) === resolve(tmpdir()) && basename(fixture).startsWith('sarin-ollama-launcher-')) rmSync(fixture, { recursive: true, force: true });
  });
  function run(configuration: string, check = false) {
    writeFileSync(join(fixture, 'ollama.env'), configuration);
    // Only these small fixture scripts run; the installed Ollama is never used.
    return spawnSync(shell, ['-c', 'launcher=$1; fixture=$2; if command -v cygpath >/dev/null 2>&1; then launcher=$(cygpath -u "$launcher"); fixture=$(cygpath -u "$fixture"); fi; PATH="$fixture:$PATH"; export PATH; if [ "$3" = check ]; then sh "$launcher" --check "$fixture/ollama.env"; else sh "$launcher" "$fixture/ollama.env"; fi', 'launcher-test', launcher, fixture, check ? 'check' : 'run'], { encoding: 'utf8', cwd: fixture, env: { ...process.env, SENSITIVE_TEST_VALUE: 'must-not-inherit' } });
  }
  it('accepts the reviewed defaults and leaves unrelated environment secrets behind', () => {
    const result = run(readFileSync('deploy/ollama.env.example', 'utf8'));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('host=127.0.0.1:11434 cloud=1 secret=absent argument=serve');
  });
  it('checks configuration without executing even the fixture Ollama binary', () => {
    const result = run('OLLAMA_NUM_PARALLEL=1\n', true);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain('argument=serve');
  });
  it('refuses cloud mode and nonloopback binding', () => {
    expect(run('OLLAMA_NO_CLOUD=0\n').status).toBe(1);
    expect(run('OLLAMA_HOST=0.0.0.0:11434\n').status).toBe(1);
  });
  it('never evaluates shell substitutions or accepts unknown keys', () => {
    const marker = join(fixture, 'injected');
    expect(run('OLLAMA_NUM_PARALLEL=$(touch injected)\n').status).toBe(1);
    expect(run('UNEXPECTED_KEY=value\n').status).toBe(1);
    expect(existsSync(marker)).toBe(false);
  });
});
