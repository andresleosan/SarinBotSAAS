import { describe, expect, it } from 'vitest';
import type { Business, DaySchedule, Tenant } from '@/types/firestore';
import { getAvailableSlots } from '@/lib/sarin/availability';
import { canonicalResourceScheduleRules, emptyResourceSchedulePolicy, resolveResourceDaySchedule, resourceSchedulePolicySchema, resourceScheduleRulesSchema, type ResourceSchedulePolicy, type ResourceScheduleRules } from '@/lib/resource-schedules';

const closed = (): DaySchedule => ({ isOpen: false, intervals: [] });
const open = (start = '09:00', end = '12:00'): DaySchedule => ({ isOpen: true, intervals: [{ start, end }] });
const week = (monday = open()): Business['weeklySchedule'] => Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, i === 1 ? monday : closed()]));
const business = (): Tenant => ({ id: 'demo-schedule', weeklySchedule: week(), resources: [{ id: 'a', name: 'A', active: true }, { id: 'b', name: 'B', active: true }, { id: 'inactive', name: 'Inactive', active: false }], services: [{ id: 's', name: 'Service', price: 0, durationMinutes: 30, bufferMinutes: 15, resourceIds: ['a', 'b', 'inactive'] }] }) as Tenant;
const policy = (rules: Partial<ResourceScheduleRules> = {}): ResourceSchedulePolicy => ({ ...emptyResourceSchedulePolicy('demo-schedule'), revision: 1, updatedAt: 1, rules: { weekly: [], exceptions: [], closures: [], ...rules } });
const slots = (p: ResourceSchedulePolicy, tenant = business(), dateKey = '2030-01-07') => getAvailableSlots({ tenant, resourceSchedulePolicy: p, dateKey, serviceId: 's', existingAppointments: [], now: 0 });
const resolve = (p: ResourceSchedulePolicy, resourceId = 'a', dateKey = '2030-01-07', common = week()) => resolveResourceDaySchedule({ business: { weeklySchedule: common }, policy: p, resourceId, dateKey });

describe('resource schedules, exceptions and closures', () => {
  it('absentPolicyPreservesLegacySlots', () => {
    expect(slots(emptyResourceSchedulePolicy('demo-schedule'))).toEqual([
      { resourceId: 'a', resourceName: 'A', slots: ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00', '11:15'] },
      { resourceId: 'b', resourceName: 'B', slots: ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00', '11:15'] },
    ]);
  });
  it('ownClosedDayDoesNotInherit', () => {
    const p = policy({ weekly: [{ resourceId: 'a', weeklySchedule: week(closed()) }] });
    expect(resolve(p)).toEqual({ isOpen: false, intervals: [] });
    expect(slots(p)[0].slots).toEqual([]); expect(slots(p)[1].slots[0]).toBe('09:00');
  });
  it('exceptionReplacesResourceDayButCannotOpenCommonClosedDay', () => {
    const p = policy({ weekly: [{ resourceId: 'a', weeklySchedule: week(closed()) }], exceptions: [{ resourceId: 'a', dateKey: '2030-01-07', day: open('10:00', '14:00') }, { resourceId: 'a', dateKey: '2030-01-06', day: open() }] });
    expect(resolve(p)).toEqual({ isOpen: true, intervals: [{ start: '10:00', end: '12:00' }] });
    expect(resolve(p, 'a', '2030-01-06')).toEqual({ isOpen: false, intervals: [] });
  });
  it('closureWinsAndUnionsOverlaps', () => {
    const p = policy({ closures: [
      { id: 'one', scope: 'business', fromDateKey: '2030-01-07', throughDateKey: '2030-01-07', interval: { start: '09:30', end: '10:30' }, label: '' },
      { id: 'two', scope: 'resource', resourceId: 'a', fromDateKey: '2030-01-07', throughDateKey: '2030-01-07', interval: { start: '10:00', end: '11:00' }, label: '' },
    ] });
    expect(resolve(p).intervals).toEqual([{ start: '09:00', end: '09:30' }, { start: '11:00', end: '12:00' }]);
    expect(resolve(p, 'b').intervals).toEqual([{ start: '09:00', end: '09:30' }, { start: '10:30', end: '12:00' }]);
  });
  it('manyClosuresProduceMoreThanFiveEffectiveSegmentsWithoutClipping', () => {
    const p = policy({ closures: Array.from({ length: 6 }, (_, i) => ({ id: `close_${i}`, scope: 'business' as const, fromDateKey: '2030-01-07', throughDateKey: '2030-01-07', interval: { start: `${10 + i}:00`, end: `${10 + i}:10` }, label: '' })) });
    expect(resourceScheduleRulesSchema.safeParse(p.rules).success).toBe(true);
    expect(resolve(p, 'a', '2030-01-07', week(open('09:00', '18:00'))).intervals).toEqual([
      { start: '09:00', end: '10:00' }, { start: '10:10', end: '11:00' }, { start: '11:10', end: '12:00' }, { start: '12:10', end: '13:00' }, { start: '13:10', end: '14:00' }, { start: '14:10', end: '15:00' }, { start: '15:10', end: '18:00' },
    ]);
  });
  it('adjacentCommonIntervalsDoNotBridge', () => {
    const tenant = business(); tenant.weeklySchedule[1] = { isOpen: true, intervals: [{ start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' }] };
    expect(slots(emptyResourceSchedulePolicy(tenant.id), tenant)[0].slots).toEqual(['09:00', '09:15', '10:00', '10:15']);
  });
  it('businessGridRemainsAnchored', () => {
    const p = policy({ weekly: [{ resourceId: 'a', weeklySchedule: week(open('09:10', '11:00')) }] });
    expect(slots(p)[0].slots).toEqual(['09:15', '09:30', '09:45', '10:00', '10:15']);
    p.rules.closures.push({ id: 'close', scope: 'resource', resourceId: 'a', fromDateKey: '2030-01-07', throughDateKey: '2030-01-07', interval: { start: '09:00', end: '10:05' }, label: '' });
    expect(slots(p)[0].slots).toEqual(['10:15']);
  });
  it('bufferMustFitEffectiveInterval', () => {
    expect(slots(policy({ weekly: [{ resourceId: 'a', weeklySchedule: week(open('09:10', '11:00')) }] }))[0].slots).not.toContain('10:30');
    expect(slots(policy({ weekly: [{ resourceId: 'a', weeklySchedule: week(open('09:10', '11:15')) }] }))[0].slots).toContain('10:30');
  });
  it('closedDayRequiresEmptyIntervals', () => {
    const rules = policy({ weekly: [{ resourceId: 'a', weeklySchedule: week({ isOpen: false, intervals: [{ start: '09:00', end: '10:00' }] }) }] }).rules;
    expect(resourceScheduleRulesSchema.safeParse(rules).success).toBe(false);
  });
  it('duplicatesAndInvalidDatesFail', () => {
    const exception = { resourceId: 'a', dateKey: '2030-02-30', day: open() };
    expect(resourceScheduleRulesSchema.safeParse({ weekly: [], exceptions: [exception], closures: [] }).success).toBe(false);
    exception.dateKey = '2030-01-07';
    expect(resourceScheduleRulesSchema.safeParse({ weekly: [], exceptions: [exception, exception], closures: [] }).success).toBe(false);
    expect(resourceScheduleRulesSchema.safeParse({ weekly: [{ resourceId: '__proto__', weeklySchedule: week() }], exceptions: [], closures: [] }).success).toBe(false);
  });
  it('inactiveAndServiceExcludedResourcesRemainExcluded', () => {
    const tenant = business(); tenant.services[0].resourceIds = ['a', 'inactive'];
    expect(slots(emptyResourceSchedulePolicy(tenant.id), tenant).map(row => row.resourceId)).toEqual(['a']);
  });
  it('fullDayClosureAppliesInclusiveRange', () => {
    const p = policy({ closures: [{ id: 'whole', scope: 'business', fromDateKey: '2030-01-06', throughDateKey: '2030-01-07', interval: null, label: '' }] });
    expect(resolve(p).intervals).toEqual([]); expect(resolve(p, 'a', '2030-01-14').intervals).toEqual([{ start: '09:00', end: '12:00' }]);
  });
  it('canonicalizationIsStableAndDoesNotMutateTheDraft', () => {
    const p = policy({ weekly: [{ resourceId: 'b', weeklySchedule: week() }, { resourceId: 'a', weeklySchedule: week({ isOpen: true, intervals: [{ start: '11:00', end: '12:00' }, { start: '09:00', end: '10:00' }] }) }] });
    const before = structuredClone(p.rules), canonical = canonicalResourceScheduleRules(p.rules);
    expect(canonical.weekly.map(row => row.resourceId)).toEqual(['a', 'b']);
    expect(canonical.weekly[0].weeklySchedule[1].intervals[0].start).toBe('09:00'); expect(p.rules).toEqual(before);
  });
  it('policyRejectsUnknownVersionAndCrossScopeClosureShape', () => {
    expect(resourceSchedulePolicySchema.safeParse({ ...policy(), version: 2 }).success).toBe(false);
    expect(resourceScheduleRulesSchema.safeParse(policy({ closures: [{ id: 'bad', scope: 'business', resourceId: 'a', fromDateKey: '2030-01-07', throughDateKey: '2030-01-07', interval: null, label: '' } as never] }).rules).success).toBe(false);
  });
});
