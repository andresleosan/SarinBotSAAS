import { describe, expect, it } from 'vitest';
import { localDevelopmentEnvironment, parseLocalArguments, javaMajorVersion } from '../scripts/lib/local-development.mjs';

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
});
