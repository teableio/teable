import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyComputedReliabilityBaseFilter } from './computed-reliability-maintenance';

afterEach(() => vi.unstubAllEnvs());
describe('issue maintenance eligibility before limits', () => {
  it('finds allowed Base rows even behind a full page of disabled rows', async () => {
    const db = newDb().adapters.createKnex();
    try {
      await db.schema.createTable('issues', (table) => {
        table.integer('id');
        table.string('base_id');
      });
      await db('issues').insert(
        Array.from({ length: 101 }, (_, id) => ({
          id,
          base_id: id === 100 ? 'allowed' : 'disabled',
        }))
      );
      vi.stubEnv('COMPUTED_RELIABILITY_BASE_IDS', 'allowed');
      const query = db('issues').select('*');
      applyComputedReliabilityBaseFilter(query, { storage: 'default' }, []);
      expect(await query.orderBy('id').limit(100)).toEqual([{ id: 100, base_id: 'allowed' }]);
    } finally {
      await db.destroy();
    }
  });
  it('excludes migrated default rows and limits BYODB to current bindings', async () => {
    const db = newDb().adapters.createKnex();
    try {
      await db.schema.createTable('issues', (table) => {
        table.string('base_id');
      });
      await db('issues').insert([{ base_id: 'default' }, { base_id: 'moved' }]);
      expect(
        await applyComputedReliabilityBaseFilter(db('issues'), { storage: 'default' }, ['moved'])
      ).toEqual([{ base_id: 'default' }]);
      expect(
        await applyComputedReliabilityBaseFilter(
          db('issues'),
          { storage: 'byodb', baseSpaceMapping: [{ baseId: 'moved' }] },
          []
        )
      ).toEqual([{ base_id: 'moved' }]);
      expect(
        await applyComputedReliabilityBaseFilter(
          db('issues'),
          { storage: 'byodb', baseSpaceMapping: [] },
          []
        )
      ).toEqual([]);
    } finally {
      await db.destroy();
    }
  });
});
