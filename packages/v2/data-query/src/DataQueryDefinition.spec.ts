import { describe, expect, it } from 'vitest';

import { DataQueryDefinition, isBoundDataQuery } from './DataQueryDefinition';

const tableId = `tbl${'a'.repeat(16)}`;
const fieldId = `fld${'a'.repeat(16)}`;
const records = { version: 1, kind: 'records', tableId, select: [{ fieldId, alias: 'title' }] };

describe('DataQueryDefinition', () => {
  it('strictly rejects malformed definitions without exposing input literals', () => {
    for (const input of [
      { ...records, sql: 'SECRET SQL' },
      { ...records, filter: { fieldId, operator: 'unknown SECRET', value: 'SECRET' } },
      { ...records, filter: { conjunction: 'and', items: [] } },
      { ...records, filter: { fieldId, operator: 'isAnyOf', value: [] } },
      { ...records, filter: { fieldId, operator: 'isEmpty', value: 'SECRET' } },
      {
        ...records,
        filter: { fieldId, operator: 'is', value: { type: 'parameter', name: 'unknown' } },
      },
    ]) {
      const result = DataQueryDefinition.create(input);
      expect(result.isErr()).toBe(true);
      expect(JSON.stringify(result._unsafeUnwrapErr())).not.toContain('SECRET');
    }
  });

  it('rejects prototype keys, inherited data and accessors without evaluating them', () => {
    expect(DataQueryDefinition.create(Object.create(records)).isErr()).toBe(true);
    const parameters = JSON.parse('{"__proto__":{"type":"string"}}');
    expect(DataQueryDefinition.create({ ...records, parameters }).isErr()).toBe(true);
    const definition = DataQueryDefinition.create(records)._unsafeUnwrap();
    expect(definition.bind(JSON.parse('{"__proto__":"injected"}')).isErr()).toBe(true);
    expect(definition.bind(Object.defineProperty({}, 'unknown', { value: 1 })).isErr()).toBe(true);
    let getterCalled = false;
    const input = Object.defineProperty({}, 'unknown', {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return 'secret';
      },
    });
    expect(definition.bind(input).isErr()).toBe(true);
    expect(getterCalled).toBe(false);
  });

  it('identifies an undeclared filter parameter before checking its representative value', () => {
    const filter = {
      fieldId,
      operator: 'isGreaterEqual',
      value: { type: 'parameter', name: 'minimum' },
    };
    const error = DataQueryDefinition.create({ ...records, filter })._unsafeUnwrapErr();
    expect(error.code).toBe('data_query.unknown_parameter');
    expect(error.message).toContain('minimum');

    const declared = DataQueryDefinition.create({
      ...records,
      filter,
      parameters: { minimum: { type: 'number' } },
    })._unsafeUnwrap();
    expect(declared.bind({ minimum: 4 })._unsafeUnwrap().filter).toEqual({
      fieldId,
      operator: 'isGreaterEqual',
      value: 4,
    });
  });

  it('binds public inputs and rejects unknown, missing and wrong-type values', () => {
    const definition = DataQueryDefinition.create({
      ...records,
      parameters: { label: { type: 'string' }, count: { type: 'number' } },
      filter: { fieldId, operator: 'is', value: { type: 'parameter', name: 'label' } },
      page: { limit: { type: 'parameter', name: 'count' } },
    })._unsafeUnwrap();
    expect(definition.bind({ count: 10, label: 'sample' })._unsafeUnwrap()).toMatchObject({
      filter: { value: 'sample' },
      limit: 10,
      offset: 0,
    });
    for (const input of [
      {},
      { count: '10' },
      { count: 1.2 },
      { count: Infinity },
      { count: 0 },
      { count: 1001 },
      { count: 10, extra: true },
    ]) {
      expect(definition.bind({ label: 'sample', ...input }).isErr()).toBe(true);
    }
    expect(definition.bind({ count: 10 }).isErr()).toBe(true);
    expect(definition.bind(Object.create({ count: 10, label: 'sample' })).isErr()).toBe(true);
    for (const source of ['input', 'context']) {
      expect(
        DataQueryDefinition.create({
          ...records,
          parameters: { label: { type: 'string', source } },
        }).isErr()
      ).toBe(true);
    }
  });

  it('validates every runtime array element and date rather than trusting representative values', () => {
    const arrayQuery = DataQueryDefinition.create({
      ...records,
      parameters: { names: { type: 'string[]' } },
      filter: { fieldId, operator: 'isAnyOf', value: { type: 'parameter', name: 'names' } },
    })._unsafeUnwrap();
    expect(arrayQuery.bind({ names: ['a', 'b'] }).isOk()).toBe(true);
    expect(arrayQuery.bind({ names: [] }).isErr()).toBe(true);
    expect(arrayQuery.bind({ names: ['a', 2] }).isErr()).toBe(true);
    const dateQuery = DataQueryDefinition.create({
      ...records,
      parameters: { date: { type: 'date' } },
      filter: { fieldId, operator: 'is', value: { type: 'parameter', name: 'date' } },
    })._unsafeUnwrap();
    expect(dateQuery.bind({ date: { mode: 'exactDate', timeZone: 'UTC' } }).isErr()).toBe(true);
    expect(
      dateQuery.bind({ date: { mode: 'today', timeZone: 'SECRET invalid timezone' } }).isErr()
    ).toBe(true);
    expect(dateQuery.bind({ date: { mode: 'today', timeZone: 'UTC' } }).isOk()).toBe(true);
  });

  it('protects snapshots, defaults and bound values from deep mutation', () => {
    const defaults = ['first'];
    const definition = DataQueryDefinition.create({
      ...records,
      parameters: { names: { type: 'string[]', default: defaults } },
      filter: { fieldId, operator: 'isAnyOf', value: { type: 'parameter', name: 'names' } },
    })._unsafeUnwrap();
    defaults.push('injected');
    const snapshot = definition.snapshot();
    snapshot.parameters!.names.default = ['changed'];
    if (snapshot.kind === 'records') snapshot.select[0].alias = 'changed';
    const first = definition.bind({})._unsafeUnwrap();
    if (first.filter && 'value' in first.filter && Array.isArray(first.filter.value)) {
      const boundValues = first.filter.value;
      expect(() => boundValues.push('injected')).toThrow();
    }
    expect(isBoundDataQuery(first)).toBe(true);
    expect(isBoundDataQuery({ ...first })).toBe(false);
    expect(isBoundDataQuery(structuredClone(first))).toBe(false);
    expect(isBoundDataQuery(Object.create(Object.getPrototypeOf(first)))).toBe(false);
    expect(definition.bind({})._unsafeUnwrap().filter).toEqual({
      fieldId,
      operator: 'isAnyOf',
      value: ['first'],
    });
    expect(definition.snapshot()).toMatchObject({ select: [{ alias: 'title' }] });
  });

  it('rejects reversed date ranges instead of allowing a predicate to become true', () => {
    const reversed = {
      mode: 'dateRange',
      exactDate: '2026-02-02T00:00:00.000Z',
      exactDateEnd: '2026-02-01T00:00:00.000Z',
      timeZone: 'UTC',
    };
    expect(
      DataQueryDefinition.create({
        ...records,
        filter: { fieldId, operator: 'is', value: reversed },
      }).isErr()
    ).toBe(true);
    const definition = DataQueryDefinition.create({
      ...records,
      parameters: { window: { type: 'date' } },
      filter: { fieldId, operator: 'is', value: { type: 'parameter', name: 'window' } },
    })._unsafeUnwrap();
    expect(definition.bind({ window: reversed }).isErr()).toBe(true);
  });

  it('rejects invalid defaults and unsafe or duplicate aliases across aggregate and group outputs', () => {
    expect(
      DataQueryDefinition.create({
        ...records,
        parameters: { value: { type: 'number', default: 'secret' } },
      }).isErr()
    ).toBe(true);
    for (const alias of ['__proto__', 'constructor', 'prototype', 'x'.repeat(64), 'bad\0alias']) {
      expect(DataQueryDefinition.create({ ...records, select: [{ fieldId, alias }] }).isErr()).toBe(
        true
      );
    }
    expect(
      DataQueryDefinition.create({
        ...records,
        select: [
          { fieldId, alias: 'same' },
          { system: 'id', alias: 'same' },
        ],
      }).isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({
        version: 1,
        kind: 'aggregate',
        tableId,
        aggregates: [{ fieldId, statisticFunc: 'count', alias: 'same' }],
        groupBy: [{ fieldId, alias: 'same' }],
      }).isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({
        ...records,
        select: [{ fieldId, alias: 'a "quoted" output' }],
      }).isOk()
    ).toBe(true);
  });

  it('never truncates grouping and restricts group ordering to grouped fields', () => {
    const groupBy = ['a', 'b', 'c', 'd'].map((seed) => ({
      fieldId: `fld${seed.repeat(16)}`,
      alias: seed,
    }));
    const aggregate = {
      version: 1,
      kind: 'aggregate',
      tableId,
      aggregates: [{ fieldId, statisticFunc: 'count', alias: 'count' }],
      groupBy,
    };
    expect(DataQueryDefinition.create(aggregate)._unsafeUnwrap().snapshot()).toMatchObject({
      groupBy,
    });
    expect(
      DataQueryDefinition.create({ ...aggregate, sort: [{ system: 'id', order: 'asc' }] }).isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({
        ...aggregate,
        sort: [{ fieldId: `fld${'z'.repeat(16)}`, order: 'asc' }],
      }).isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({ ...aggregate, sort: [{ fieldId, order: 'desc' }] }).isOk()
    ).toBe(true);
  });
});
