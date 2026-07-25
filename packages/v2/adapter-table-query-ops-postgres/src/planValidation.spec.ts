import type { Table } from '@teable/v2-core';
import {
  TableQueryIndexInspection,
  TableQueryObservationWindow,
  TableQueryShape,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';

import { PostgresTableQueryPlanValidator } from './planValidation';
import type { UnknownPostgresDatabase } from './types';

describe('PostgresTableQueryPlanValidator', () => {
  it('skips validation without a normalized SQL sample', async () => {
    const shape = TableQueryShape.create({
      queryKind: 'filter',
      whereShape: {
        conditionCount: 1,
        andDepth: 1,
        orDepth: 0,
        fields: [{ fieldId: 'fld_name', fieldType: 'singleLineText', operatorFamily: 'equality' }],
      },
      executionShape: { durationMs: 100, timedOut: false },
    })._unsafeUnwrap();
    const observation = TableQueryObservationWindow.create({
      baseId: 'bse_test',
      tableId: 'tbl_test',
      windowStart: new Date('2026-06-01T00:00:00.000Z'),
      windowSizeSeconds: 300,
      shape,
      requestCount: 1,
      slowCount: 0,
      timeoutCount: 0,
      dbErrorCount: 0,
      totalDurationMs: 100,
      maxDurationMs: 100,
    })._unsafeUnwrap();
    const indexInspection = TableQueryIndexInspection.create({
      state: 'missing',
      usefulIndexes: [],
      missingIndexCandidates: [
        {
          fieldId: 'fld_name',
          fieldDbName: 'name',
          kind: 'btree',
          reason: 'Filter predicate can use btree index',
        },
      ],
      abnormalIndexes: [],
    })._unsafeUnwrap();
    const validator = new PostgresTableQueryPlanValidator({} as Kysely<UnknownPostgresDatabase>);

    const result = await validator.validate({} as never, {
      table: {} as Table,
      observation,
      indexInspection,
    });

    expect(result._unsafeUnwrap().snapshot()).toMatchObject({
      status: 'skipped',
      reason: 'normalized_sql_sample_missing',
      candidateCount: 1,
    });
  });
});
