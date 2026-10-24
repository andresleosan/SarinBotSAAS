import { describe, expect, it } from 'vitest';
import {
  agendaToday, getOwnerAgendaDayLayout, getOwnerAgendaRange, getOwnerAgendaResources,
  getOwnerAgendaScale, rejectDuplicateAgendaIds, shiftAgendaDate,
  type OwnerAgendaDay,
} from '../src/lib/owner-agenda';
import type { Appointment, Business, TenantResource } from '../src/types/firestore';

const now = Date.parse('2026-10-22T02:00:00Z');
const dateKey = '2026-10-21';
const at = (time: string, date = dateKey) => Date.parse(`${date}T${time}:00-05:00`);
function appointment(id: string, changes: Partial<Appointment> = {}): Appointment {
  return {
    id, tenantId: 'demo-agenda', dateKey, startAt: at('09:00'), endAt: at('09:30'),
    reservedUntilAt: at('09:45'), startTimeStr: '09:00', endTimeStr: '09:30',
    type: 'appointment', resourceId: 'chair', serviceId: 'cut', serviceName: 'Corte',
    status: 'confirmed', createdBy: 'sarin_client', createdAt: now, ...changes,
  };
}
const ready = (date: string, appointments: Appointment[]): OwnerAgendaDay => ({ dateKey: date, state: 'ready', appointments });

describe('owner agenda dates', () => {
  // Catches using the host calendar or UTC date instead of Colombia.
  it('colombiaDateIgnoresHostZone', () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
        process.env.TZ = zone;
        expect(agendaToday(now)).toBe('2026-10-21');
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  it('mondayWeekCrossesYear', () => {
    expect(getOwnerAgendaRange('2027-01-01', 'week', now)).toEqual({
      selectedDate: '2027-01-01', dates: ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'],
      queryDates: ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'], outsideDates: [],
    });
    expect(shiftAgendaDate('2027-01-01', -7)).toBe('2026-12-25');
    expect(shiftAgendaDate('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('weekClampsQueryDatesAt366Days', () => {
    expect(getOwnerAgendaRange('2027-10-22', 'week', now)).toEqual({
      selectedDate: '2027-10-22', dates: ['2027-10-18', '2027-10-19', '2027-10-20', '2027-10-21', '2027-10-22', '2027-10-23', '2027-10-24'],
      queryDates: ['2027-10-18', '2027-10-19', '2027-10-20', '2027-10-21', '2027-10-22'], outsideDates: ['2027-10-23', '2027-10-24'],
    });
    expect(getOwnerAgendaRange('2027-10-23', 'day', now)).toBeNull();
    expect(getOwnerAgendaRange('1900-01-01', 'day', now)?.queryDates).toEqual(['1900-01-01']);
  });
  it('invalidDateHasNoRange', () => {
    expect(getOwnerAgendaRange('2024-02-29', 'day', now)?.dates).toEqual(['2024-02-29']);
    for (const invalid of ['', '2026-02-29', '2026-04-31', '2026-1-01', 'invalid', '2026-00-01']) {
      expect(getOwnerAgendaRange(invalid, 'day', now)).toBeNull();
    }
  });
});

describe('saved owner agenda occupancy', () => {
  // Catches drawing service through its buffer or replacing the saved endpoint.
  it('savedBufferWinsOverCurrentCatalog', () => {
    const layout = getOwnerAgendaDayLayout(dateKey, [appointment('saved')]);
    expect(layout.blocks).toEqual([{ appointmentId: 'saved', resourceId: 'chair', startMinute: 540, serviceEndMinute: 570, reservedEndMinute: 585, lane: 0, laneCount: 1, manual: false }]);
    expect(layout.warnings).toEqual({});
  });
  it('missingBufferDoesNotInventPreparation', () => {
    for (const buffer of [undefined, NaN, at('09:15')]) {
      const layout = getOwnerAgendaDayLayout(dateKey, [appointment('legacy', { reservedUntilAt: buffer as number })]);
      expect(layout.blocks[0]).toMatchObject({ serviceEndMinute: 570, reservedEndMinute: 570 });
      expect(layout.warnings.legacy).toEqual(['Margen no registrado']);
    }
  });
  it('manualBlocksUseTheirOwnIntervalWithoutPreparation', () => {
    const layout = getOwnerAgendaDayLayout(dateKey, [appointment('manual', { type: 'manual_block', reservedUntilAt: at('11:00') })]);
    expect(layout.blocks[0]).toMatchObject({ serviceEndMinute: 570, reservedEndMinute: 570, manual: true });
    expect(layout.warnings).toEqual({});
  });
  it('cancelledAndUnknownStatusesDoNotOccupy', () => {
    const appointments = ['cancelled_by_client', 'cancelled_by_owner', 'completed', 'no_show', 'legacy'].map((status) => appointment(status, { status: status as Appointment['status'] }));
    expect(getOwnerAgendaDayLayout(dateKey, [...appointments, appointment('confirmed')]).blocks.map(block => block.appointmentId)).toEqual(['confirmed']);
    expect(appointments).toHaveLength(5);
  });
  it('inactiveAndDeletedResourcesRetainHistory', () => {
    const resources: TenantResource[] = [{ id: 'z', name: 'Z', active: true }, { id: 'chair', name: 'Silla anterior', active: false }, { id: 'a', name: 'A', active: true }, { id: 'unused', name: 'Sin historia', active: false }];
    const days = [ready(dateKey, [appointment('old', { status: 'completed' }), appointment('deleted-z', { resourceId: 'gone-z' }), appointment('deleted-a', { resourceId: 'gone-a', status: 'cancelled_by_owner' })]), { dateKey: '2026-10-20', state: 'error', message: 'error' } as OwnerAgendaDay];
    expect(getOwnerAgendaResources(resources, days)).toEqual([
      { id: 'z', label: 'Z', kind: 'active' }, { id: 'a', label: 'A', kind: 'active' },
      { id: 'chair', label: 'Silla anterior · Inactivo', kind: 'inactive' },
      { id: 'gone-a', label: 'Recurso no disponible · gone-a', kind: 'unknown' }, { id: 'gone-z', label: 'Recurso no disponible · gone-z', kind: 'unknown' },
    ]);
  });
  // Catches rounding short events, ignoring buffer collisions, and unstable input order.
  it('shortOverlapHasStableLanes', () => {
    const appointments = [
      appointment('b', { startAt: at('09:00'), endAt: at('09:03'), reservedUntilAt: at('09:08') }),
      appointment('a', { startAt: at('09:00'), endAt: at('09:05'), reservedUntilAt: at('09:05') }),
      appointment('c', { startAt: at('09:05'), endAt: at('09:06'), reservedUntilAt: at('09:10') }),
      appointment('d', { startAt: at('09:10'), endAt: at('09:12'), reservedUntilAt: at('09:12') }),
      appointment('other', { resourceId: 'other', startAt: at('09:00'), endAt: at('09:02'), reservedUntilAt: at('09:02') }),
    ];
    const layout = getOwnerAgendaDayLayout(dateKey, appointments);
    expect(layout.blocks.map(({ appointmentId, lane, laneCount }) => ({ appointmentId, lane, laneCount }))).toEqual([
      { appointmentId: 'a', lane: 0, laneCount: 2 }, { appointmentId: 'b', lane: 1, laneCount: 2 },
      { appointmentId: 'other', lane: 0, laneCount: 1 }, { appointmentId: 'c', lane: 0, laneCount: 2 }, { appointmentId: 'd', lane: 0, laneCount: 1 },
    ]);
    expect(layout.blocks.find(block => block.appointmentId === 'a')).toMatchObject({ startMinute: 540, serviceEndMinute: 545 });
    expect(getOwnerAgendaDayLayout(dateKey, [...appointments].reverse())).toEqual(layout);
  });
  it('crossMidnightAndInvalidTimeStayInList', () => {
    const appointments = [
      appointment('cross', { startAt: at('23:30'), endAt: at('00:15', '2026-10-22'), reservedUntilAt: at('00:30', '2026-10-22') }),
      appointment('bad', { startAt: NaN }), appointment('backwards', { endAt: at('08:00') }),
      appointment('wrong-day', { startAt: at('09:00', '2026-10-20'), endAt: at('09:30', '2026-10-20'), reservedUntilAt: at('09:45', '2026-10-20') }),
    ];
    const layout = getOwnerAgendaDayLayout(dateKey, appointments);
    expect(layout.blocks).toHaveLength(1);
    expect(layout.blocks[0]).toMatchObject({ appointmentId: 'cross', startMinute: 1410, serviceEndMinute: 1440, reservedEndMinute: 1440 });
    expect(layout.warnings).toEqual({ cross: ['El registro continúa fuera de este día'], bad: ['Horario no verificable'], backwards: ['Horario no verificable'], 'wrong-day': ['Horario no verificable'] });
    expect(appointments.map(item => item.id)).toEqual(['cross', 'bad', 'backwards', 'wrong-day']);
  });
  it('historicalBogotaOffsetKeepsNineAtNine', () => {
    const historicalDate = '1992-06-01';
    const layout = getOwnerAgendaDayLayout(historicalDate, [appointment('historical', {
      dateKey: historicalDate,
      startAt: Date.parse('1992-06-01T09:00:00-04:00'),
      endAt: Date.parse('1992-06-01T09:30:00-04:00'),
      reservedUntilAt: Date.parse('1992-06-01T09:45:00-04:00'),
    })]);
    expect(layout.blocks[0]).toMatchObject({ startMinute: 540, serviceEndMinute: 570, reservedEndMinute: 585 });
    expect(layout.warnings).toEqual({});
  });
  it('historicalBogotaDayClipsAtItsOwnLocalMidnight', () => {
    const historicalDate = '1992-06-01';
    const appointments = [appointment('early', {
      dateKey: historicalDate, startAt: Date.parse('1992-06-01T00:15:00-04:00'),
      endAt: Date.parse('1992-06-01T00:30:00-04:00'), reservedUntilAt: Date.parse('1992-06-01T00:45:00-04:00'),
    }), appointment('late', {
      dateKey: historicalDate, startAt: Date.parse('1992-06-01T23:30:00-04:00'),
      endAt: Date.parse('1992-06-02T00:15:00-04:00'), reservedUntilAt: Date.parse('1992-06-02T00:30:00-04:00'),
    })];
    const layout = getOwnerAgendaDayLayout(historicalDate, appointments);
    expect(layout.blocks.map(({ appointmentId, startMinute, serviceEndMinute, reservedEndMinute }) => ({ appointmentId, startMinute, serviceEndMinute, reservedEndMinute }))).toEqual([
      { appointmentId: 'early', startMinute: 15, serviceEndMinute: 30, reservedEndMinute: 45 },
      { appointmentId: 'late', startMinute: 1410, serviceEndMinute: 1440, reservedEndMinute: 1440 },
    ]);
    expect(layout.warnings).toEqual({ late: ['El registro continúa fuera de este día'] });
    expect(appointments).toHaveLength(2);
  });
  it('offsetTransitionStaysInTheListWithoutAnAmbiguousGraphInterval', () => {
    const historicalDate = '1992-05-03';
    const appointments = [appointment('transition', {
      dateKey: historicalDate, startAt: Date.parse('1992-05-02T23:30:00-05:00'),
      endAt: Date.parse('1992-05-03T01:30:00-04:00'), reservedUntilAt: Date.parse('1992-05-03T01:45:00-04:00'),
    })];
    const layout = getOwnerAgendaDayLayout(historicalDate, appointments);
    expect(layout.blocks).toEqual([]);
    expect(layout.warnings.transition).toEqual(['Horario no verificable']);
    expect(appointments[0].id).toBe('transition');
  });
  it('invalidStartDoesNotDisruptChronologicalOrderingOrLanes', () => {
    const layout = getOwnerAgendaDayLayout(dateKey, [
      appointment('a-later', { startAt: at('10:00'), endAt: at('10:15'), reservedUntilAt: at('10:15') }),
      appointment('m-invalid', { startAt: NaN }),
      appointment('z-earlier'),
    ]);
    expect(layout.blocks.map(({ appointmentId, lane, laneCount }) => ({ appointmentId, lane, laneCount }))).toEqual([
      { appointmentId: 'z-earlier', lane: 0, laneCount: 1 }, { appointmentId: 'a-later', lane: 0, laneCount: 1 },
    ]);
    expect(layout.warnings['m-invalid']).toEqual(['Horario no verificable']);
  });
  it('duplicateIdInvalidatesEveryAffectedDay', () => {
    const days: OwnerAgendaDay[] = [ready(dateKey, [appointment('moved')]), ready('2026-10-22', [appointment('moved', { dateKey: '2026-10-22' })]), ready('2026-10-23', [appointment('unique')]), { dateKey: '2026-10-24', state: 'outside' }];
    expect(rejectDuplicateAgendaIds(days)).toEqual([
      { dateKey, state: 'error', message: 'La agenda cambió; actualiza' }, { dateKey: '2026-10-22', state: 'error', message: 'La agenda cambió; actualiza' }, days[2], days[3],
    ]);
    expect(days[0].state).toBe('ready');
  });
});

describe('common owner agenda scale', () => {
  it('roundsSavedOccupancyAndOpenSplitSchedulesAcrossTheRange', () => {
    const range = getOwnerAgendaRange(dateKey, 'week', now)!;
    const schedule: Business['weeklySchedule'] = {
      1: { isOpen: true, intervals: [{ start: '07:30', end: '11:30' }, { start: '14:00', end: '19:15' }] },
      2: { isOpen: false, intervals: [{ start: '00:00', end: '24:00' }] },
      3: { isOpen: true, intervals: [{ start: 'bad', end: '23:00' }, { start: '12:00', end: '10:00' }] },
    };
    const layout = getOwnerAgendaDayLayout(dateKey, [appointment('early', { startAt: at('06:10'), endAt: at('06:30'), reservedUntilAt: at('06:45') }), appointment('late-cancelled', { startAt: at('23:00'), endAt: at('23:30'), reservedUntilAt: at('23:45'), status: 'cancelled_by_client' })]);
    expect(getOwnerAgendaScale(schedule, range, [layout])).toEqual({ startMinute: 360, endMinute: 1200 });
    expect(getOwnerAgendaScale({}, range, [])).toEqual({ startMinute: 480, endMinute: 1080 });
    expect(getOwnerAgendaScale(schedule, getOwnerAgendaRange(dateKey, 'day', now)!, [])).toEqual({ startMinute: 480, endMinute: 1080 });
  });
  it('clipsTheScaleAtMidnightForHistoricalOccupancy', () => {
    const layout = getOwnerAgendaDayLayout(dateKey, [appointment('cross', { startAt: at('23:30'), endAt: at('00:10', '2026-10-22'), reservedUntilAt: at('00:10', '2026-10-22') })]);
    expect(getOwnerAgendaScale({}, getOwnerAgendaRange(dateKey, 'day', now)!, [layout])).toEqual({ startMinute: 1380, endMinute: 1440 });
  });
});
