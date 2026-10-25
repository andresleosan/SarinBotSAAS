import { describe, expect, it } from 'vitest';
import {
  ownerRescheduleCommandSchema, ownerRescheduleAvailabilitySchema, ownerRescheduleSourceSchema,
  ownerRescheduleProposalViewSchema, ownerRescheduleRecoverySchema, ownerRescheduleConfirmationSchema,
  parseOwnerRescheduleReference,
} from '@/lib/owner-rescheduling';
import { ownerRescheduleSource as appointment, ownerRescheduleView as proposal, ownerRescheduleResult as result } from './owner-rescheduling-contract';

const command = { requestId: 'demo-request', sourceRevision: 0, sourceFingerprint: 'a'.repeat(64), selection: proposal.target && { dateKey: '2030-01-07', startTimeStr: '10:00', resourceId: 'demo-chair' } };
const moved = { ...appointment, dateKey: result.dateKey, startTimeStr: '10:00', endTimeStr: '10:30', startAt: result.startAt, endAt: result.endAt, reservedUntilAt: proposal.target.reservedUntilAt, rescheduleRevision: 1 };
describe('owner rescheduling transport validation', () => {
  it('strictCommandRejectsActorContactServiceAndUnknownFields', () => {
    expect(ownerRescheduleCommandSchema.safeParse(command).success).toBe(true);
    for (const field of ['actorUid', 'clientPhone', 'serviceId', 'beneficiary', 'extra']) expect(ownerRescheduleCommandSchema.safeParse({ ...command, [field]: 'demo' }).success).toBe(false);
    expect(ownerRescheduleCommandSchema.safeParse({ ...command, selection: { ...command.selection, serviceId: 'demo-cut' } }).success).toBe(false);
    for (const patch of [{ startTimeStr: '10:00\n' }, { resourceId: 'demo-chair\n' }]) expect(ownerRescheduleCommandSchema.safeParse({ ...command, selection: { ...command.selection, ...patch } }).success).toBe(false);
    expect(ownerRescheduleAvailabilitySchema.safeParse({ sourceRevision: 0, sourceFingerprint: 'a'.repeat(64), dateKey: '2030-01-07' }).success).toBe(true);
  });
  it('revisionZeroAndOverflowAreExplicit', () => {
    for (const sourceRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) expect(ownerRescheduleCommandSchema.safeParse({ ...command, sourceRevision }).success).toBe(false);
    expect(ownerRescheduleCommandSchema.safeParse({ ...command, sourceRevision: Number.MAX_SAFE_INTEGER - 2 }).success).toBe(true);
  });
  it('invalidDateAndTimestampCannotBecomeAvailable', () => {
    for (const patch of [{ dateKey: '2030-02-30' }, { startAt: NaN }, { startAt: 1 }, { reservedUntilAt: appointment.endAt - 1 }, { endTimeStr: '09:31' }, { price: -1 }]) expect(ownerRescheduleSourceSchema.safeParse({ appointment: { ...appointment, ...patch }, expectation: { sourceRevision: 0, sourceFingerprint: 'a'.repeat(64) }, eligible: true, reason: null }).success).toBe(false);
    const parsed = ownerRescheduleSourceSchema.parse({ appointment, expectation: { sourceRevision: 0, sourceFingerprint: 'a'.repeat(64) }, eligible: true, reason: null });
    expect(parsed.appointment).toHaveProperty('historicalMetadata', { imported: true });
    expect(ownerRescheduleSourceSchema.safeParse({ ...parsed, expectation: { ...parsed.expectation, sourceRevision: 1 } }).success).toBe(false);
  });
  it('proposalProofMatchesSourceAndTarget', () => {
    expect(ownerRescheduleProposalViewSchema.safeParse(proposal).success).toBe(true);
    for (const patch of [{ endAt: proposal.target.endAt + 1 }, { durationMinutes: 45 }, { bufferMinutes: 0 }, { endTimeStr: '10:45' }]) expect(ownerRescheduleProposalViewSchema.safeParse({ ...proposal, target: { ...proposal.target, ...patch } }).success).toBe(false);
    const recovery = { proposal, state: 'applied', appointment: moved, result };
    expect(ownerRescheduleRecoverySchema.safeParse(recovery).success).toBe(true);
    for (const patch of [{ proposalId: 'other' }, { revision: 2 }, { startAt: result.startAt + 1 }]) expect(ownerRescheduleRecoverySchema.safeParse({ ...recovery, result: { ...result, ...patch } }).success).toBe(false);
    expect(ownerRescheduleRecoverySchema.safeParse({ ...recovery, state: 'prepared' }).success).toBe(false);
    expect(ownerRescheduleConfirmationSchema.safeParse({ appointment: moved, rescheduleResult: result, replayed: false }).success).toBe(true);
  });
  it('appliedRecoveryCanCarryLaterCurrentAppointment', () => {
    const current = { ...appointment, status: 'cancelled_by_owner', rescheduleRevision: 2 };
    expect(ownerRescheduleRecoverySchema.parse({ proposal, state: 'applied', appointment: current, result }).appointment.startTimeStr).toBe('09:00');
  });
  it('an applied proof must have been confirmed inside its proposal window and before both starts', () => {
    for (const confirmedAt of [0, proposal.expiresAt, proposal.expiresAt - 600001, proposal.target.startAt]) {
      expect(ownerRescheduleRecoverySchema.safeParse({ proposal, state: 'applied', appointment: moved, result: { ...result, confirmedAt } }).success).toBe(false);
    }
    expect(ownerRescheduleSourceSchema.safeParse({ appointment: { ...appointment, status: 'cancelled_by_owner' }, expectation: { sourceRevision: 0, sourceFingerprint: 'a'.repeat(64) }, eligible: true, reason: null }).success).toBe(false);
  });
  it('validatesMidnightAndCrossDaySourceWithoutInventingHistoricalPrice', () => {
    const source = { ...proposal.source, startTimeStr: '23:30', endTimeStr: '24:00', startAt: 1894077000000, endAt: 1894078800000, reservedUntilAt: 1894079700000, priceCOP: null };
    expect(ownerRescheduleProposalViewSchema.safeParse({ ...proposal, source }).success).toBe(true);
    expect(ownerRescheduleProposalViewSchema.safeParse({ ...proposal, source: { ...source, endTimeStr: '00:00' } }).success).toBe(true);
    expect(ownerRescheduleProposalViewSchema.safeParse({ ...proposal, source: { ...source, endTimeStr: '24:30' } }).success).toBe(false);
  });
  it('urlAcceptsOneOpaqueReferenceOnly', () => {
    expect(parseOwnerRescheduleReference('?ownerReschedule=demo-proposal&client=secret')).toEqual({ proposalId: 'demo-proposal', error: null });
    expect(parseOwnerRescheduleReference('?other=value')).toEqual({ proposalId: null, error: null });
    for (const search of ['?ownerReschedule=a&ownerReschedule=b', '?ownerReschedule=', '?ownerReschedule=a%2Fb', '?ownerReschedule=a%0A']) expect(parseOwnerRescheduleReference(search)).toMatchObject({ proposalId: null, error: expect.any(String) });
  });
});
