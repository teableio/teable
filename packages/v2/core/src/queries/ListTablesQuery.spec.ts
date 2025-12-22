import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ListTablesQuery } from './ListTablesQuery';

describe('ListTablesQuery', () => {
  it('creates query with default sort and no pagination', () => {
    const baseIdResult = BaseId.generate();
    expect(baseIdResult.isOk()).toBe(true);
    if (baseIdResult.isErr()) return;

    const queryResult = ListTablesQuery.create({ baseId: baseIdResult.value.toString() });
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const query = queryResult.value;
    const [field] = query.sort.fields();
    expect(field.key.toString()).toBe('name');
    expect(field.direction.toString()).toBe('asc');
    expect(query.pagination).toBeUndefined();
  });

  it('builds sort and pagination when provided', () => {
    const baseIdResult = BaseId.generate();
    expect(baseIdResult.isOk()).toBe(true);
    if (baseIdResult.isErr()) return;

    const queryResult = ListTablesQuery.create({
      baseId: baseIdResult.value.toString(),
      sortBy: 'id',
      sortDirection: 'desc',
      limit: 10,
      offset: 5,
    });
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const query = queryResult.value;
    const [field] = query.sort.fields();
    expect(field.key.toString()).toBe('id');
    expect(field.direction.toString()).toBe('desc');
    expect(query.pagination?.limit().toNumber()).toBe(10);
    expect(query.pagination?.offset().toNumber()).toBe(5);
  });

  it('rejects invalid inputs', () => {
    expect(ListTablesQuery.create({ baseId: 'bad' }).isErr()).toBe(true);
    expect(
      ListTablesQuery.create({ baseId: 'bse' + 'a'.repeat(16), sortDirection: 'asc' }).isErr()
    ).toBe(true);
    expect(ListTablesQuery.create({ baseId: 'bse' + 'a'.repeat(16), offset: 1 }).isErr()).toBe(
      true
    );
  });
});
