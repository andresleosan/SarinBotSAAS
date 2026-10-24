import { describe, expect, it } from 'vitest';
import {
  compareOwnerClientRecordRows, ownerClientRecordInputSchema, ownerClientRecordPageSchema,
  projectOwnerClientRecordRow, ownerClientRecordStatusLabel, ownerClientRecordBeneficiaryLabel,
  ownerClientRecordEndLabel, OwnerClientRecordModelError,
} from '@/lib/owner-client-record';
import { makeOwnerClientRecordAppointment, ownerClientRecordBusinessId, ownerClientRecordUid,
  ownerClientRecordResources } from './owner-client-record-fixture';

const context = { businessId: ownerClientRecordBusinessId, clientUid: ownerClientRecordUid, resources: ownerClientRecordResources };
const revision = 'a'.repeat(64);
const row = {
  appointmentId: 'demo-record-appointment', dateKey: '2030-01-07', startAt: 1894024800000,
  endAt: 1894026600000, status: 'confirmed' as const, resourceLabel: 'Demo resource', beneficiaryKind: 'represented_minor' as const,
};
const input = { clientUid: ownerClientRecordUid, filter: 'all' };
const cursor = { appointmentId: row.appointmentId, startAt: row.startAt, revision };
const page = {
  scope: { businessId: ownerClientRecordBusinessId, sourceAppointmentId: row.appointmentId, clientUid: ownerClientRecordUid },
  filter: 'all', checkedAt: 1894027500000, rows: [row], nextCursor: null,
  coverage: { mode: 'indexed_appointments', completeness: 'not_guaranteed' },
};
function project(overrides: Record<string, unknown> = {}) {
  return projectOwnerClientRecordRow(row.appointmentId, { ...makeOwnerClientRecordAppointment(), ...overrides }, context);
}

describe('owner client record model', () => {
  it('strictBodyHasFixedFilterAndCursor', () => {
    expect(ownerClientRecordInputSchema.parse(input)).toEqual(input);
    expect(ownerClientRecordInputSchema.parse({ ...input, cursor })).toEqual({ ...input, cursor });
    for (const bad of [{ clientUid: ownerClientRecordUid }, { ...input, filter: 'confirmed' }, { ...input, cursor: null },
      { ...input, sourceAppointmentId: row.appointmentId }, [input]]) {
      expect(ownerClientRecordInputSchema.safeParse(bad).success).toBe(false);
    }
    for (const filter of ['completed', 'no_show']) expect(ownerClientRecordInputSchema.safeParse({ ...input, filter }).success).toBe(true);
  });
  it('rejectsArbitraryPageSizeUidControlsAndTrailingNewline', () => {
    expect(ownerClientRecordInputSchema.safeParse({ ...input, pageSize: 20 }).success).toBe(false);
    for (const clientUid of ['', 'x'.repeat(129), ...Array.from({ length: 32 }, (_, code) => `uid${String.fromCharCode(code)}`), 'uid\x7f', 'uid\n']) {
      expect(ownerClientRecordInputSchema.safeParse({ ...input, clientUid }).success).toBe(false);
    }
    for (const clientUid of ['A b:@/unicode-ñ', 'x'.repeat(128), ' uid ']) {
      expect(ownerClientRecordInputSchema.parse({ ...input, clientUid }).clientUid).toBe(clientUid);
    }
  });
  it('cursorRequiresCanonicalIdTimestampAnd64HexRevision', () => {
    expect(ownerClientRecordInputSchema.parse({ ...input, cursor })).toEqual({ ...input, cursor });
    for (const appointmentId of ['', 'a/b', 'a\n', 'a'.repeat(129), 'ñ']) {
      expect(ownerClientRecordInputSchema.safeParse({ ...input, cursor: { ...cursor, appointmentId } }).success).toBe(false);
    }
    for (const startAt of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER, 8640000000000001]) {
      expect(ownerClientRecordInputSchema.safeParse({ ...input, cursor: { ...cursor, startAt } }).success).toBe(false);
    }
    for (const revision of ['a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), `${'a'.repeat(64)}\n`]) {
      expect(ownerClientRecordInputSchema.safeParse({ ...input, cursor: { ...cursor, revision } }).success).toBe(false);
    }
    expect(ownerClientRecordInputSchema.safeParse({ ...input, cursor: { ...cursor, extra: true } }).success).toBe(false);
  });
  it('projectionUsesAllowlistOnly', () => {
    expect(JSON.parse(JSON.stringify(project({ arbitraryPrivateField: 'synthetic private' })))).toEqual(row);
    expect(ownerClientRecordPageSchema.parse(page)).toEqual(page);
  });
  it('minorNameRoleIntakeAndContactsNeverLeaveProjection', () => {
    const projected = project();
    expect(Object.keys(projected).sort()).toEqual(['appointmentId', 'beneficiaryKind', 'dateKey', 'endAt', 'resourceLabel', 'startAt', 'status']);
    expect(JSON.parse(JSON.stringify(projected))).toEqual(row);
    expect(ownerClientRecordBeneficiaryLabel(projected.beneficiaryKind)).toBe('Representante de un menor');
  });
  it('unknownBeneficiaryIsNotSelf', () => {
    expect(project({ beneficiary: undefined }).beneficiaryKind).toBe('unverified');
    const absent = makeOwnerClientRecordAppointment();
    delete absent.beneficiary;
    expect(projectOwnerClientRecordRow(absent.id, absent, context).beneficiaryKind).toBe('undeclared');
    for (const beneficiary of [null, {}, { kind: 'other' }, { kind: 'self', displayName: 'Unexpected' },
      { kind: 'represented_minor', displayName: 'Demo', representativeRole: 'sibling' }]) {
      expect(project({ beneficiary }).beneficiaryKind).toBe('unverified');
    }
    expect(project({ beneficiary: { kind: 'self' } }).beneficiaryKind).toBe('self');
    expect(['self', 'undeclared', 'unverified'].map(kind => ownerClientRecordBeneficiaryLabel(kind as 'self' | 'undeclared' | 'unverified')))
      .toEqual(['Para sí', 'Sin declaración guardada', 'Dato no verificable']);
  });
  it('unknownStatusIsNotConfirmed', () => {
    for (const status of [undefined, null, '', 'attended', 1]) expect(project({ status }).status).toBe('unverified');
    expect(ownerClientRecordStatusLabel('unverified', row.startAt, row.startAt + 1)).toBe('Dato no verificable');
  });
  it('invalidEndTimeIsExplicit', () => {
    for (const endAt of [undefined, null, row.startAt - 1, 0, 1.5, Infinity, 8640000000000001]) {
      expect(project({ endAt }).endAt).toBe(null);
      expect(ownerClientRecordEndLabel(project({ endAt }).endAt)).toBe('Fin no verificable');
    }
    expect(project({ endAt: row.startAt }).endAt).toBe(row.startAt);
    expect(ownerClientRecordEndLabel(row.endAt)).toBe(null);
  });
  it('deletedResourceDoesNotHideHistory', () => {
    expect(project({ resourceId: 'deleted-id-must-not-leak' })).toEqual({ ...row, resourceLabel: 'Recurso anterior' });
    expect(project({ resourceId: 'demo-inactive' }).resourceLabel).toBe('Previous demo resource · Inactivo');
    for (const name of ['', ' '.repeat(4), 'x'.repeat(121), null, 'Demo\nresource']) {
      expect(projectOwnerClientRecordRow(row.appointmentId, makeOwnerClientRecordAppointment(), {
        ...context, resources: [{ id: 'demo-chair', name, active: true }],
      }).resourceLabel).toBe('Recurso anterior');
    }
    expect(projectOwnerClientRecordRow(row.appointmentId, makeOwnerClientRecordAppointment(), {
      ...context, resources: [{ id: 'demo-chair', name: '<b>Literal</b>', active: true }],
    }).resourceLabel).toBe('<b>Literal</b>');
  });
  it('inactiveResourceLabelFits120WithoutSplittingEmoji', () => {
    const inactive = (name: string) => projectOwnerClientRecordRow(row.appointmentId, makeOwnerClientRecordAppointment(), {
      ...context, resources: [{ id: 'demo-chair', name, active: false }],
    }).resourceLabel;
    expect(inactive('x'.repeat(120))).toBe(`${'x'.repeat(109)} · Inactivo`);
    expect(inactive(`${'x'.repeat(108)}😀${'y'.repeat(10)}`)).toBe(`${'x'.repeat(108)} · Inactivo`);
    expect(inactive(`${'x'.repeat(107)}😀${'y'.repeat(11)}`)).toBe(`${'x'.repeat(107)}😀 · Inactivo`);
  });
  it('colombiaDateDerivedFromSavedStart', () => {
    expect(project({ dateKey: '1999-01-01', startTimeStr: '23:00', startAt: Date.parse('2030-01-08T02:00:00Z'), endAt: undefined }))
      .toEqual({ ...row, dateKey: '2030-01-07', startAt: 1894068000000, endAt: null });
    expect(project({ startAt: Date.parse('2030-01-08T05:00:00Z'), endAt: undefined }).dateKey).toBe('2030-01-08');
  });
  it('ordinalIdsHaveSameTieOrderRegardlessLocale', () => {
    const ids = ['a', '_', '-', 'Z', 'A', '0', 'z'];
    const rows = ids.map(appointmentId => ({ ...row, appointmentId }));
    expect(rows.sort(compareOwnerClientRecordRows).map(value => value.appointmentId)).toEqual(['-', '0', 'A', 'Z', '_', 'a', 'z']);
    expect([{ ...row, startAt: row.startAt - 1 }, row, { ...row, startAt: row.startAt + 1 }].sort(compareOwnerClientRecordRows).map(value => value.startAt))
      .toEqual([1894024800001, 1894024800000, 1894024799999]);
    expect(compareOwnerClientRecordRows(row, row)).toBe(0);
  });
  it('invalidCoreIdentityCannotBeSkipped', () => {
    for (const raw of [null, [], {}]) expect(() => projectOwnerClientRecordRow(row.appointmentId, raw, context)).toThrow(OwnerClientRecordModelError);
    for (const invalid of [{ id: 'wrong-id' }, { id: `${row.appointmentId}\n` }, { tenantId: 'other-business' },
      { type: 'manual_block' }, { client: undefined }, { client: { uid: 'other-client' } }, { client: { uid: `${ownerClientRecordUid}\n` } },
      { startAt: undefined }, { startAt: 0 }, { startAt: 1.5 }, { startAt: 8640000000000001 }]) {
      const raw = { ...makeOwnerClientRecordAppointment(), ...invalid };
      expect(() => projectOwnerClientRecordRow(row.appointmentId, raw, context)).toThrow(OwnerClientRecordModelError);
      try { projectOwnerClientRecordRow(row.appointmentId, raw, context); } catch (error) {
        expect(error).toMatchObject({ status: 503, code: 'CLIENT_RECORD_UNVERIFIABLE' });
      }
    }
    expect(() => projectOwnerClientRecordRow(`${row.appointmentId}\n`, makeOwnerClientRecordAppointment(), context)).toThrow();
    expect(() => projectOwnerClientRecordRow(row.appointmentId, makeOwnerClientRecordAppointment(), { ...context, businessId: `${context.businessId}\n` })).toThrow();
  });
  it('pastConfirmedIsNotAttendance', () => {
    expect(project().status).toBe('confirmed');
    expect(ownerClientRecordStatusLabel('confirmed', row.startAt, row.startAt + 1)).toBe('Confirmada · sin resultado registrado');
    expect(ownerClientRecordStatusLabel('confirmed', row.startAt, row.startAt - 1)).toBe('Confirmada');
  });
  it('completedAndNoShowArePersistedStatesNotCounters', () => {
    expect(project({ status: 'completed' })).toEqual({ ...row, status: 'completed' });
    expect(project({ status: 'no_show' })).toEqual({ ...row, status: 'no_show' });
    expect(['completed', 'no_show', 'cancelled_by_client', 'cancelled_by_owner'].map(status => ownerClientRecordStatusLabel(status as typeof row.status, row.startAt, 0)))
      .toEqual(['Atendida', 'No asistió', 'Cancelada por cliente', 'Cancelada por propietario']);
  });
  it('invalidResponseTimestampReturnsValidationFailure', () => {
    for (const startAt of [0, -1, 1.5, NaN, Infinity, 8640000000000001]) {
      expect(ownerClientRecordPageSchema.safeParse({ ...page, rows: [{ ...row, startAt }] }).success).toBe(false);
    }
  });
  it('strictResponseRejectsPrivateFieldsOrderAndIncoherentCursor', () => {
    const badPages = [
      { ...page, total: 1 }, { ...page, scope: { ...page.scope, email: 'synthetic@example.test' } },
      { ...page, rows: [{ ...row, serviceName: 'Synthetic service' }] }, { ...page, coverage: { mode: 'indexed_appointments', completeness: 'complete' } },
      { ...page, rows: Array.from({ length: 21 }, (_, i) => ({ ...row, appointmentId: `row-${i}` })) },
      { ...page, rows: [row, row] }, { ...page, rows: [row, { ...row, appointmentId: 'A', startAt: row.startAt + 1 }] },
      { ...page, rows: [{ ...row, dateKey: '2000-01-01' }] }, { ...page, rows: [{ ...row, resourceLabel: 'x'.repeat(121) }] }, { ...page, rows: [{ ...row, endAt: row.startAt - 1 }] },
      { ...page, filter: 'completed' }, { ...page, nextCursor: cursor },
    ];
    for (const value of badPages) expect(ownerClientRecordPageSchema.safeParse(value).success).toBe(false);
    const twentyRows = Array.from({ length: 20 }, (_, i) => ({ ...row, appointmentId: `row-${String(i).padStart(2, '0')}` }));
    expect(ownerClientRecordPageSchema.safeParse({ ...page, rows: twentyRows, nextCursor: { ...cursor, appointmentId: 'row-19' } }).success).toBe(true);
    expect(ownerClientRecordPageSchema.safeParse({ ...page, rows: twentyRows, nextCursor: { ...cursor, appointmentId: 'row-18' } }).success).toBe(false);
    expect(ownerClientRecordPageSchema.safeParse({ ...page, filter: 'completed', rows: [{ ...row, status: 'completed' }] }).success).toBe(true);
    expect(ownerClientRecordPageSchema.safeParse({ ...page, rows: [] }).success).toBe(true);
  });
});
