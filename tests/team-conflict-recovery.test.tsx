import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Database } from '@/lib/storage/types';
import type { TeamOwnerDecisionCommand } from '@/lib/business-team';
import { useBusinessTeam } from '@/hooks/use-business-team';
import { useTeamWorkspace } from '@/hooks/use-team-workspace';
import { GET as ownerGet } from '@/app/api/businesses/[id]/team/route';
import { PATCH as ownerPatch } from '@/app/api/businesses/[id]/team/[membershipId]/route';
import { GET as memberGet } from '@/app/api/team/memberships/route';
import { DELETE as memberDelete } from '@/app/api/team/memberships/[membershipId]/route';
import { requestTeamAccess, decideTeamAccess, readOwnerBusinessTeam } from '@/lib/server/business-team';
import { acceptSyntheticConsent } from './consent-fixtures';
import { memoryFirestore } from './memoryFirestore';
import { teamFixture, teamNow } from './business-team-contract';

type Failure = 'network'|'invalid-success'|'timeout'|'untyped409'|'other409'|'wrong-status';
const state = vi.hoisted(() => ({
  db: null as unknown as Database,
  uid: 'demo-team-owner',
  failure: null as Failure|null,
}));
vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: () => state.db,
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: state.uid }) }),
}));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: {
  uid: state.uid, getIdToken: async () => 'synthetic-conflict-token',
} } }) }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({
  user: { uid: state.uid }, authEpoch: 1,
  isCurrentSession: (uid: string, epoch: number) => uid === state.uid && epoch === 1,
  invalidateSession: vi.fn(),
}) }));

let renderer: ReactTestRenderer;
let owner: ReturnType<typeof useBusinessTeam>;
let member: ReturnType<typeof useTeamWorkspace>;
let fixture: Awaited<ReturnType<typeof teamFixture>>;
let membershipId: string;
const writes: { method: string; path: string; body: string }[] = [];
const replies: { status: number; code?: string }[] = [];

function Owner() {
  owner = useBusinessTeam({ businessId: fixture.business.id, ownerUid: fixture.owner.uid, authEpoch: 1, enabled: true });
  return null;
}
function Member() {
  member = useTeamWorkspace({ uid: fixture.member.uid, authEpoch: 1, enabled: true });
  return null;
}
async function mountOwner(active = false) {
  if (active) await approveMember();
  state.uid = fixture.owner.uid;
  await act(async () => { renderer = create(createElement(Owner)); });
}
async function mountMember() {
  state.uid = fixture.member.uid;
  await act(async () => { renderer = create(createElement(Member)); });
}
async function approveMember() {
  await decideTeamAccess(fixture.owner, fixture.business.id, membershipId, {
    action: 'approve', requestId: 'demo-concurrent-approve', expectedMembershipRevision: 1,
    expectedTeamRevision: 1, resourceId: 'demo-chair',
  }, state.db);
}
async function advanceTeam() {
  const other = { uid: 'demo-concurrent-member' };
  await acceptSyntheticConsent(state.db, other.uid);
  await requestTeamAccess(other, {
    businessSlug: fixture.business.slug, requestId: 'demo-concurrent-request', expectedMembershipRevision: 0,
  }, state.db);
}
const command = (action: 'approve'|'reject'|'revoke', requestId: string, teamRevision: number): TeamOwnerDecisionCommand => ({
  action, requestId, expectedMembershipRevision: action === 'revoke' ? 2 : 1, expectedTeamRevision: teamRevision,
  ...(action === 'approve' ? { resourceId: 'demo-chair' } : {}),
} as TeamOwnerDecisionCommand);

beforeEach(async () => {
  vi.setSystemTime(teamNow);
  vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'true');
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.failure = null;
  state.uid = 'demo-team-owner';
  writes.length = 0;
  replies.length = 0;
  state.db = memoryFirestore().db as unknown as Database;
  fixture = await teamFixture(state.db);
  const requested = await requestTeamAccess(fixture.member, fixture.request, state.db);
  membershipId = requested.current.membershipId;
  vi.stubGlobal('fetch', vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(path), 'http://localhost'), init);
    if (request.method === 'PATCH' || request.method === 'DELETE') {
      writes.push({ method: request.method, path: request.url, body: String(init?.body) });
      const failure = state.failure;
      state.failure = null;
      if (failure === 'network') throw new TypeError('Connection lost before an acknowledgement.');
      if (failure === 'timeout') throw new DOMException('Transport timed out.', 'TimeoutError');
      if (failure === 'invalid-success') return Response.json({});
      if (failure === 'untyped409') return Response.json({ error: 'Conflict' }, { status: 409 });
      if (failure === 'other409') return Response.json({ error: 'Conflict', code: 'TEAM_REQUEST_REUSED' }, { status: 409 });
      if (failure === 'wrong-status') return Response.json({ error: 'Unavailable', code: 'TEAM_REVISION_CONFLICT' }, { status: 503 });
    }
    let response: Response;
    if (request.method === 'PATCH') response = await ownerPatch(request, { params: Promise.resolve({ id: fixture.business.id, membershipId }) });
    else if (request.method === 'DELETE') response = await memberDelete(request, { params: Promise.resolve({ membershipId }) });
    else if (new URL(request.url).pathname === '/api/team/memberships') response = await memberGet(request);
    else response = await ownerGet(request, { params: Promise.resolve({ id: fixture.business.id }) });
    const result = await response.clone().json() as { code?: string };
    replies.push({ status: response.status, code: result.code });
    return response;
  }));
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['approve', 'reject', 'revoke'] as const)('first definite %s revision conflict requires fresh review and allows a new command', async action => {
  await mountOwner(action === 'revoke');
  const oldTeamRevision = action === 'revoke' ? 2 : 1;
  const stale = command(action, 'demo-stale-decision', oldTeamRevision);
  await advanceTeam();
  await act(async () => owner.decide(membershipId, stale));
  // Actual domain HttpError -> route JSON -> apiFetch ApiError -> real owner hook.
  expect(replies.at(-1)).toEqual({ status: 409, code: 'TEAM_REVISION_CONFLICT' });
  expect(owner.pending).toBe(false);
  expect(owner.busy).toBe(false);
  expect(owner.applied).toBeNull();
  expect(owner.view).toBeNull();
  expect(owner.protected).toBe(false);
  const fresh = command(action, 'demo-reviewed-decision', oldTeamRevision + 1);
  await act(async () => owner.decide(membershipId, fresh));
  expect(writes).toHaveLength(1); // No replacement command before a fresh snapshot.
  await act(async () => owner.refresh());
  expect(owner.view?.teamRevision).toBe(oldTeamRevision + 1);
  await act(async () => owner.decide(membershipId, stale));
  expect(writes).toHaveLength(1); // The old reviewed revisions cannot be reused.
  await act(async () => owner.decide(membershipId, fresh));
  expect(owner.applied?.requestId).toBe('demo-reviewed-decision');
  expect(owner.current?.status).toBe({ approve: 'active', reject: 'rejected', revoke: 'revoked' }[action]);
  expect(owner.pending).toBe(false);
  expect(JSON.parse(writes[1].body)).toEqual(fresh);
});

it('first definite staff withdrawal conflict requires fresh membership review and allows a new withdrawal', async () => {
  await mountMember();
  await approveMember(); // Another actor changes requested revision1 to active revision2.
  await act(async () => member.leave(membershipId, { requestId: 'demo-stale-leave', expectedMembershipRevision: 1 }));
  expect(replies.at(-1)).toEqual({ status: 409, code: 'TEAM_REVISION_CONFLICT' });
  expect(member.pending).toBe(false);
  expect(member.page).toBeNull();
  expect(member.applied).toBeNull();
  await act(async () => member.leave(membershipId, { requestId: 'demo-reviewed-leave', expectedMembershipRevision: 2 }));
  expect(writes).toHaveLength(1);
  await act(async () => member.loadMemberships());
  expect(member.page?.items[0]).toMatchObject({ status: 'active', revision: 2 });
  await act(async () => member.leave(membershipId, { requestId: 'demo-stale-leave', expectedMembershipRevision: 1 }));
  expect(writes).toHaveLength(1);
  await act(async () => member.leave(membershipId, { requestId: 'demo-reviewed-leave', expectedMembershipRevision: 2 }));
  expect(member.applied?.requestId).toBe('demo-reviewed-leave');
  expect(member.current?.status).toBe('revoked');
  expect(member.pending).toBe(false);
});

it.each(['network', 'invalid-success', 'timeout'] as const)('owner %s ambiguity followed by exact retry409 keeps the sealed command', async failure => {
  await mountOwner();
  const stale = command('approve', 'demo-uncertain-decision', 1);
  state.failure = failure;
  await act(async () => owner.decide(membershipId, stale));
  expect(owner.pending).toBe(true);
  await advanceTeam();
  await act(async () => owner.retryPending());
  expect(replies.at(-1)).toEqual({ status: 409, code: 'TEAM_REVISION_CONFLICT' });
  expect(owner.pending).toBe(true);
  expect(owner.applied).toBeNull();
  expect(writes[1]).toEqual(writes[0]);
  await act(async () => owner.inspectPending()); // The real GET finds no receipt, not proof of failure.
  expect(owner.view?.applied).toBeNull();
  expect(owner.pending).toBe(true);
  await act(async () => owner.decide(membershipId, command('approve', 'demo-blocked-decision', 2)));
  expect(writes).toHaveLength(2);
  await act(async () => owner.retryPending());
  expect(writes[2]).toEqual(writes[0]);
  expect(owner.pending).toBe(true);
  expect((await readOwnerBusinessTeam(fixture.owner, fixture.business.id, undefined, state.db)).active).toEqual([]);
});

it('staff ambiguous withdrawal followed by exact retry409 stays sealed through current-page inspection', async () => {
  await mountMember();
  state.failure = 'network';
  await act(async () => member.leave(membershipId, { requestId: 'demo-uncertain-leave', expectedMembershipRevision: 1 }));
  await approveMember();
  await act(async () => member.retryPending());
  expect(replies.at(-1)).toEqual({ status: 409, code: 'TEAM_REVISION_CONFLICT' });
  expect(member.pending).toBe(true);
  expect(member.applied).toBeNull();
  expect(writes[1]).toEqual(writes[0]);
  await act(async () => member.inspectPending());
  expect(member.page?.items[0]).toMatchObject({ status: 'active', revision: 2 });
  expect(member.pending).toBe(true);
  await act(async () => member.leave(membershipId, { requestId: 'demo-blocked-leave', expectedMembershipRevision: 2 }));
  expect(writes).toHaveLength(2);
});

it.each(['untyped409', 'other409', 'wrong-status'] as const)('first %s is not an authoritative revision refusal', async failure => {
  await mountOwner();
  state.failure = failure;
  await act(async () => owner.decide(membershipId, command('approve', 'demo-unknown-refusal', 1)));
  expect(owner.pending).toBe(true);
  expect(owner.applied).toBeNull();
  await advanceTeam();
  await act(async () => owner.retryPending());
  expect(replies.at(-1)).toEqual({ status: 409, code: 'TEAM_REVISION_CONFLICT' });
  expect(owner.pending).toBe(true);
  expect(writes[1]).toEqual(writes[0]);
});
