import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import type { DataRead } from '../shared/data-protocol';

let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>;
afterEach(async () => { await runtime?.dispose(); });

it('offers lists use additive date and state indexes without scans or temporary sorts', async () => {
  runtime = await createDataTestRuntime({ captureSql: true });
  await runtime.db.exec(readFileSync('cloudflare/migrations/0010_waitlist_offers.sql', 'utf8').replace(/^--.*$/gm, '').replace(/\r?\n/g, ' '));
  const indexes = (await runtime.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all()).results.map((row: { name: string }) => row.name);
  expect(indexes).toEqual(expect.arrayContaining(['app_waitlist_offers_date', 'app_waitlist_offers_state', 'app_waitlist_owner_review_record']));
  expect(indexes.filter((name: string) => name.startsWith('app_waitlist_offers_')).sort()).toEqual(['app_waitlist_offers_date', 'app_waitlist_offers_state']);
  const path = 'businesses/demo-offers/waitlistOffers';
  const query = (state?: string, tail?: 'same' | 'older'): DataRead => ({ kind: 'query', path,
    filters: [{ field: 'dateKey', op: '==', value: '2030-01-07' }, ...(state ? [{ field: 'state', op: '==' as const, value: state }] : []),
      ...(tail === 'same' ? [{ field: 'createdAt', op: '==' as const, value: 100 }, { field: 'id', op: '>' as const, value: 'offer-a' }] : tail === 'older' ? [{ field: 'createdAt', op: '<' as const, value: 100 }] : [])],
    order: tail === 'same' ? [{ field: 'id', direction: 'asc' }] : [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }], limit: 21 });
  for (const state of [undefined, 'offered', 'booked']) for (const tail of [undefined, 'same', 'older'] as const) {
    const explanation = await runtime.explain!(query(state, tail));
    expect(explanation.plan.some((row: { detail: string }) => row.detail.includes(state ? 'app_waitlist_offers_state' : 'app_waitlist_offers_date'))).toBe(true);
    expect(explanation.plan.some((row: { detail: string }) => /SCAN app_documents|USE TEMP B-TREE/.test(row.detail)), JSON.stringify({ state, tail, ...explanation })).toBe(false);
  }
  const firestore = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
  const field = (fieldPath: string, order = 'ASCENDING') => ({ fieldPath, order });
  expect(firestore.indexes.filter((index: { collectionGroup: string }) => index.collectionGroup === 'waitlistOffers')).toEqual([
    { collectionGroup: 'waitlistOffers', queryScope: 'COLLECTION', fields: [field('dateKey'), field('createdAt', 'DESCENDING'), field('id')] },
    { collectionGroup: 'waitlistOffers', queryScope: 'COLLECTION', fields: [field('dateKey'), field('state'), field('createdAt', 'DESCENDING'), field('id')] },
  ]);
}, 30000);

it('historical allowlist fixtures retain their original private children without admitting offers', async () => {
  for (const option of ['previousBusinessChildren', 'previousOwnerRescheduleChildren', 'previousFactualFaqChildren', 'previousOwnerWaitlistChildren']) {
    const historical = await createDataTestRuntime({ [option]: true });
    try {
      for (const child of ['waitlistOfferHeads', 'waitlistOffers']) {
        const result = await historical.fetch({ action: 'read', read: { kind: 'document', path: `businesses/demo-offers/${child}/record` } });
        expect(result.status).toBe(400);
        expect(await result.json()).toMatchObject({ code: 'DATA_INVALID' });
      }
      const result = await historical.fetch({ action: 'read', read: { kind: 'query', path: 'businesses/demo-offers/waitlistRequests', filters: [], order: [] } });
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ documents: [] });
    } finally {
      await historical.dispose();
    }
  }
}, 30000);
