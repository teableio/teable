import createKnex from 'knex';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyComputedReliabilityBaseFilter,
  reliabilityCandidateQuery,
} from './computed-reliability-maintenance';

afterEach(() => vi.unstubAllEnvs());
describe('reliability candidate SQL', () => {
  it('does not emit a three-part identifier when joining under internalSchema', async () => {
    const db = createKnex({ client: 'pg' });
    try {
      const sql = reliabilityCandidateQuery(db, 'teable_7244155acaadc2bf').toSQL().sql;
      expect(sql).toContain('"teable_7244155acaadc2bf"."computed_reliability_scope" as "s"');
      expect(sql).toContain(
        'inner join "teable_7244155acaadc2bf"."computed_reliability_issue" as "i"'
      );
      expect(sql).not.toContain(
        '"teable_7244155acaadc2bf"."teable_7244155acaadc2bf"."computed_reliability_issue"'
      );
    } finally {
      await db.destroy();
    }
  });

  it('leaves public relations unqualified when internalSchema is absent', async () => {
    const db = createKnex({ client: 'pg' });
    try {
      const sql = reliabilityCandidateQuery(db, undefined).toSQL().sql;
      expect(sql).toContain('inner join "computed_reliability_issue" as "i"');
      expect(sql).not.toMatch(/"[^"]+"\."[^\.]+\."computed_reliability_issue"/);
    } finally {
      await db.destroy();
    }
  });
});
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
