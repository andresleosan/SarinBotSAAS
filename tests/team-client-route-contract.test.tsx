import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Database } from '@/lib/storage/types';
import { memoryFirestore } from './memoryFirestore';
import { teamFixture, teamNow } from './business-team-contract';
import { requestTeamAccess, decideTeamAccess } from '@/lib/server/business-team';
import { GET } from '@/app/api/team/businesses/[id]/agenda/route';
import { useTeamWorkspace } from '@/hooks/use-team-workspace';

const state = vi.hoisted(() => ({
  db: null as unknown as Database,
  uid: 'demo-team-member',
  verifyIdToken: vi.fn(async (_token: string) => ({ uid: 'demo-team-member' })),
}));
vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: () => state.db,
  getAdminAuth: () => ({ verifyIdToken: state.verifyIdToken }),
}));
vi.mock('@/lib/firebase/client', () => ({
  getFirebaseClient: () => ({ auth: { currentUser: {
    uid: state.uid,
    getIdToken: async () => 'synthetic-team-token',
  } } }),
}));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({
  user: { uid: state.uid }, authEpoch: 1,
  isCurrentSession: (uid: string, epoch: number) => uid === state.uid && epoch === 1,
  invalidateSession: vi.fn(),
}) }));

let renderer: ReactTestRenderer;
let controller: ReturnType<typeof useTeamWorkspace>;
const responses: { status: number; url: string }[] = [];

function Harness() {
  controller = useTeamWorkspace({ uid: state.uid, authEpoch: 1, businessId: 'demo-team-business', enabled: true });
  return null;
}

beforeEach(async () => {
  vi.setSystemTime(teamNow);
  vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'true');
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  responses.length = 0;
  state.verifyIdToken.mockClear();
  state.db = memoryFirestore().db as unknown as Database;
  const fixture = await teamFixture(state.db);
  const requested = await requestTeamAccess(fixture.member, fixture.request, state.db);
  await decideTeamAccess(fixture.owner, fixture.business.id, requested.current.membershipId, {
    action: 'approve', requestId: 'demo-approve-client-route', expectedMembershipRevision: 1,
    expectedTeamRevision: 1, resourceId: 'demo-chair',
  }, state.db);
  vi.stubGlobal('fetch', vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(path), 'http://localhost');
    const request = new Request(url, init);
    const response = await GET(request, { params: Promise.resolve({ id: url.pathname.split('/').at(-2)! }) });
    responses.push({ status: response.status, url: url.href });
    return response;
  }));
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  ['2030-01-07T15:00:00Z', '2030-01-07', '2030-01-08'],
  ['2032-05-19T16:00:00Z', '2032-05-19', '2032-05-20'],
])('authenticated hook reads the actual assigned-agenda route at %s', async (clock, today, tomorrow) => {
  // Establish active membership at the fixture clock, then independently advance the read clock.
  // Agenda reads intentionally need no active plan after that time has passed.
  vi.setSystemTime(new Date(clock));
  const startAt = Date.parse(`${today}T09:00:00-05:00`);
  await state.db.collection('businesses').doc('demo-team-business').collection('appointments').doc('demo-route-appointment').set({
    id: 'demo-route-appointment', tenantId: 'demo-team-business', resourceId: 'demo-chair', dateKey: today,
    startAt, endAt: startAt + 1800000, reservedUntilAt: startAt + 1800000,
    type: 'appointment', status: 'confirmed',
  });
  await act(async () => { renderer = create(createElement(Harness)); });
  expect({ status: responses[0]?.status, agenda: controller.agenda }).toMatchObject({
    status: 200,
    agenda: {
      businessId: 'demo-team-business', dateKey: today, checkedAt: Date.parse(clock), membershipRevision: 2,
      resource: { id: 'demo-chair', name: 'Demo chair' },
      rows: [{ id: 'demo-route-appointment', startAt, endAt: startAt + 1800000, kind: 'appointment', status: 'confirmed' }],
    },
  });
  expect(controller.error).toBeNull();
  expect(state.verifyIdToken).toHaveBeenCalledWith('synthetic-team-token', true);
  await act(async () => controller.readAgenda(tomorrow));
  expect(responses.at(-1)?.status).toBe(200);
  expect(controller.agenda).toMatchObject({ dateKey: tomorrow, rows: [] });
  expect(new URL(responses.at(-1)!.url).searchParams.get('resourceId')).toBeNull();
});
