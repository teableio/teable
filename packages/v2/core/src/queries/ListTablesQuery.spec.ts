import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ListTablesQuery } from './ListTablesQuery';

describe('ListTablesQuery', () => {
  it('creates query with default sort and no pagination', () => {
    const baseIdResult = BaseId.generate();
    baseIdResult._unsafeUnwrap();

    const queryResult = ListTablesQuery.create({ baseId: baseIdResult._unsafeUnwrap().toString() });
    queryResult._unsafeUnwrap();

    const query = queryResult._unsafeUnwrap();
    const [field] = query.sort.fields();
    expect(field.key.toString()).toBe('createdTime');
    expect(field.direction.toString()).toBe('desc');
    expect(query.pagination).toBeUndefined();
  });

  it('builds sort and pagination when provided', () => {
    const baseIdResult = BaseId.generate();
    baseIdResult._unsafeUnwrap();

    const queryResult = ListTablesQuery.create({
      baseId: baseIdResult._unsafeUnwrap().toString(),
      sortBy: 'id',
      sortDirection: 'desc',
      limit: 10,
      offset: 5,
    });
    queryResult._unsafeUnwrap();

    const query = queryResult._unsafeUnwrap();
    const [field] = query.sort.fields();
    expect(field.key.toString()).toBe('id');
    expect(field.direction.toString()).toBe('desc');
    expect(query.pagination?.limit().toNumber()).toBe(10);
    expect(query.pagination?.offset().toNumber()).toBe(5);
  });

  it('accepts name search query', () => {
    const baseIdResult = BaseId.generate();
    baseIdResult._unsafeUnwrap();

    const queryResult = ListTablesQuery.create({
      baseId: baseIdResult._unsafeUnwrap().toString(),
      q: '  Alpha  ',
    });
    queryResult._unsafeUnwrap();

    expect(queryResult._unsafeUnwrap().nameQuery?.toString()).toBe('Alpha');
  });
});
