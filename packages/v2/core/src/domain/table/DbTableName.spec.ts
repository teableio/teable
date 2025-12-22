import { describe, expect, it } from 'vitest';

import { DbTableName } from './DbTableName';

describe('DbTableName', () => {
  it('rehydrates and splits with schema', () => {
    const result = DbTableName.rehydrate('public.tables');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const splitResult = result.value.split();
    expect(splitResult.isOk()).toBe(true);
    if (splitResult.isErr()) return;
    expect(splitResult.value).toEqual({ schema: 'public', tableName: 'tables' });
  });

  it('uses default schema when missing', () => {
    const result = DbTableName.rehydrate('tables');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const splitResult = result.value.split({ defaultSchema: 'public' });
    expect(splitResult.isOk()).toBe(true);
    if (splitResult.isErr()) return;
    expect(splitResult.value).toEqual({ schema: 'public', tableName: 'tables' });
  });

  it('rejects invalid values and empty access', () => {
    expect(DbTableName.rehydrate('').isErr()).toBe(true);

    const empty = DbTableName.empty();
    const splitResult = empty.split();
    expect(splitResult.isErr()).toBe(true);
  });
});
