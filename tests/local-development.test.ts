import { describe, expect, it } from 'vitest';
import { localDevelopmentEnvironment, parseLocalArguments, javaMajorVersion, pnpmFirebaseInvocation } from '../scripts/lib/local-development.mjs';

describe('isolated local development launcher', () => {
  it('pins a demo project and loopback emulators while removing inherited cloud credentials', () => {
    const env = localDevelopmentEnvironment({ FIREBASE_ADMIN_PRIVATE_KEY:'must-not-be-inherited', FIREBASE_ADMIN_CLIENT_EMAIL:'private@example.com', FIREBASE_TOKEN:'secret', GOOGLE_APPLICATION_CREDENTIALS:'/secret.json', FIREBASE_ADMIN_PROJECT_ID:'production-project', NEXT_PUBLIC_FIREBASE_PROJECT_ID:'production-project', SUPERADMIN_UID:'real-admin', PATH:'runtime-path' });
    expect(env.FIREBASE_ADMIN_PRIVATE_KEY).toBeUndefined(); expect(env.FIREBASE_TOKEN).toBeUndefined(); expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(env.FIREBASE_ADMIN_PROJECT_ID).toBe('demo-sarin-bot'); expect(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID).toBe('demo-sarin-bot');
    expect(env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9099'); expect(env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    expect(env.NEXT_PUBLIC_FIREBASE_EMULATORS).toBe('true'); expect(env.SUPERADMIN_UID).toBe('sarin-local-admin'); expect(env.PATH).toBe('runtime-path');
  });
  it('accepts only explicit non privileged local ports and known flags', () => {
    expect(parseLocalArguments([])).toEqual({port:3030,help:false});
    expect(parseLocalArguments(['--port','3040'])).toEqual({port:3040,help:false});
    expect(parseLocalArguments(['--help']).help).toBe(true);
    for (const args of [['--port','80'],['--port','bad'],['--project','production'],['--port','65536']]) expect(()=>parseLocalArguments(args)).toThrow();
  });
  it('reads legacy and current Java versions without confusing patch or vendor numbers', () => {
    expect(javaMajorVersion('java version "1.8.0_503"')).toBe(8);
    expect(javaMajorVersion('openjdk version "21.0.12" 2026-07-21 LTS')).toBe(21);
    expect(javaMajorVersion('openjdk 24.0.1 2025-04-15')).toBe(24);
    expect(javaMajorVersion('not installed')).toBeNull();
  });

  it('uses the actual pnpm JavaScript CLI through Node with an isolated pinned Firebase tool', () => {
    const invocation = pnpmFirebaseInvocation({ npm_execpath: '/opt/pnpm/bin/pnpm.mjs', npm_config_user_agent: 'pnpm/11.23.0 npm/? node/v24.13.1 linux x64' }, '/workspace/Sarin Bot', '/usr/bin/node');
    expect(invocation.command).toBe('/usr/bin/node');
    expect(invocation.args.slice(0, 3)).toEqual(['/opt/pnpm/bin/pnpm.mjs', 'dlx', '--allow-build=protobufjs']);
    expect(invocation.args.slice(3)).toEqual(['firebase-tools@15.33.0', 'emulators:start', '--only', 'auth,firestore', '--project', 'demo-sarin-bot', '--config', '/workspace/Sarin Bot/firebase.json', '--non-interactive']);
    expect(invocation.args).not.toContain('--yes');
    expect(invocation.args.some(argument => argument.includes('allow-all-build'))).toBe(false);
  });

  it('constructs a Windows command without shell quoting and supports a native pnpm executable', () => {
    const env = { npm_execpath: 'C:\\Program Files\\pnpm\\pnpm.exe', npm_config_user_agent: 'pnpm/11.23.0 npm/? node/v24.13.1 win32 x64' };
    const invocation = pnpmFirebaseInvocation(env, 'F:\\Proyectos\\Sarin Bot pnpm-migration', 'C:\\Program Files\\nodejs\\node.exe');
    expect(invocation.command).toBe(env.npm_execpath);
    expect(invocation.args[0]).toBe('dlx');
    expect(invocation.args).toContain('F:\\Proyectos\\Sarin Bot pnpm-migration\\firebase.json');
    expect(invocation.args.every(argument => !argument.startsWith('"'))).toBe(true);
  });

  it('refuses npm, another pnpm version, missing provenance and shell wrappers before tool launch', () => {
    const valid = { npm_execpath: '/opt/pnpm/bin/pnpm.mjs', npm_config_user_agent: 'pnpm/11.23.0 npm/? node/v24.13.1' };
    for (const change of [{ npm_execpath: undefined }, { npm_config_user_agent: undefined }, { npm_config_user_agent: 'npm/11.6.0 node/v24' }, { npm_config_user_agent: 'pnpm/10.0.0 node/v24' }, { npm_config_user_agent: 'pnpm/12.0.0 node/v24' }, { npm_execpath: '/usr/bin/npm-cli.js' }, { npm_execpath: 'pnpm.mjs' }, { npm_execpath: 'C:\\pnpm\\pnpm.cmd' }, { npm_execpath: '/opt/pnpm/pnpm.mjs\n--help' }]) {
      expect(() => pnpmFirebaseInvocation({ ...valid, ...change }, '/workspace/Sarin Bot', '/usr/bin/node')).toThrow(/pnpm/);
    }
  });
});
