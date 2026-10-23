import { describe, expect, it } from 'vitest';

import { IndexBuilderPostgres } from './search-index-builder.postgres';

const builder = new IndexBuilderPostgres();
const fieldNamesById = new Map([
  ['fldCase', 'Case_ID'],
  ['fldStarted', 'Started_At'],
  ['__id', '__id'],
  ['__created_time', '__created_time'],
]);

describe('query index SQL', () => {
  it('builds a composite field index', () => {
    expect(
      builder.createQueryIndexSql(
        'bseQuery.tblQuery',
        {
          id: 'perf_case_started',
          columns: [
            { kind: 'field', fieldId: 'fldCase', direction: 'asc' },
            { kind: 'field', fieldId: 'fldStarted', direction: 'desc' },
          ],
        },
        fieldNamesById,
        'tblQuery'
      )
    ).toBe(
      'CREATE INDEX IF NOT EXISTS "idx_qry_97989abc_perf_case_started" ON "bseQuery"."tblQuery" USING btree ("Case_ID" ASC, "Started_At" DESC)'
    );
  });

  it('builds a coalesce expression index', () => {
    expect(
      builder.createQueryIndexSql(
        'bseQuery.tblQuery',
        {
          id: 'sync_run_sort',
          columns: [
            {
              kind: 'coalesce',
              fieldIds: ['fldStarted', '__created_time'],
              direction: 'desc',
            },
            { kind: 'field', fieldId: '__id', direction: 'desc' },
          ],
        },
        fieldNamesById,
        'tblQuery'
      )
    ).toBe(
      'CREATE INDEX IF NOT EXISTS "idx_qry_97989abc_sync_run_sort" ON "bseQuery"."tblQuery" USING btree (COALESCE("Started_At", "__created_time") DESC, "__id" DESC)'
    );
  });

  it('only inspects and drops managed query indexes', () => {
    expect(builder.getQueryIndexInfoSql('bseQuery.tblQuery')).toContain("LIKE 'idx_qry_%'");
    expect(builder.getDropQueryIndexesSql('bseQuery.tblQuery')).toContain("LIKE 'idx_qry_%'");
  });
});
