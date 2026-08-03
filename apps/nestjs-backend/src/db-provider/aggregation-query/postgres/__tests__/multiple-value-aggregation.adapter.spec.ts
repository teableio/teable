import type { FieldCore } from '@teable/core';
import { FieldType } from '@teable/core';
import knex from 'knex';
import { describe, expect, it } from 'vitest';
import type { IRecordQueryAggregateContext } from '../../../../features/record/query-builder/record-query-builder.interface';
import { MultipleValueAggregationAdapter } from '../multiple-value/multiple-value-aggregation.adapter';
import { SingleValueAggregationAdapter } from '../single-value/single-value-aggregation.adapter';

const knexClient = knex({ client: 'pg' });

const createAdapter = () => {
  const field = {
    id: 'fldNumericArray',
    dbFieldName: '"values"',
    isMultipleCellValue: true,
    type: FieldType.Number,
  } as unknown as FieldCore;

  const context: IRecordQueryAggregateContext = {
    selectionMap: new Map([[field.id, '"alias"."values"']]),
    tableDbName: 'public.test_table',
    tableAlias: 'alias',
  };

  return new MultipleValueAggregationAdapter(knexClient, field, context);
};

describe('MultipleValueAggregationAdapter numeric coercion', () => {
  it.each([
    ['sum', (adapter: MultipleValueAggregationAdapter) => adapter.sum()],
    ['average', (adapter: MultipleValueAggregationAdapter) => adapter.average()],
    ['max', (adapter: MultipleValueAggregationAdapter) => adapter.max()],
    ['min', (adapter: MultipleValueAggregationAdapter) => adapter.min()],
  ])('renders %s aggregation without integer casts', (_, getSql) => {
    const adapter = createAdapter();
    const sql = getSql(adapter);
    expect(sql).toContain('::double precision');
    expect(sql).toContain('REGEXP_REPLACE');
    expect(sql.toUpperCase()).not.toContain('::INTEGER');
  });
});

describe('AggregationFunctionPostgres identifier quoting', () => {
  it('quotes mixed-case db field names when no selection exists', () => {
    const field = {
      id: 'fldServicesSynced',
      dbFieldName: 'Services_Synced',
      isMultipleCellValue: false,
      type: FieldType.SingleSelect,
    } as unknown as FieldCore;

    const context: IRecordQueryAggregateContext = {
      selectionMap: new Map(),
      tableDbName: 'bse901tdwRNJK9h92Sy.New_table2Fy0tma2JW',
      tableAlias: 't0',
    };

    const adapter = new SingleValueAggregationAdapter(knexClient, field, context);

    expect(adapter.filled()).toBe('COUNT("t0"."Services_Synced")');
  });

  it('preserves already-qualified base-query field references', () => {
    const field = {
      id: 'fldAge',
      dbFieldName: '"bseTestBaseId"."New_table"."age"',
      isMultipleCellValue: false,
      type: FieldType.Number,
    } as unknown as FieldCore;

    const context: IRecordQueryAggregateContext = {
      selectionMap: new Map(),
      tableDbName: 'bseTestBaseId.New_table',
      tableAlias: 'main_table',
    };

    const adapter = new SingleValueAggregationAdapter(knexClient, field, context);

    expect(adapter.average()).toBe('AVG("bseTestBaseId"."New_table"."age")');
  });
});
