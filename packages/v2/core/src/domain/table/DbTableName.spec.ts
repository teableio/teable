import { describe, expect, it } from 'vitest';

import { DbTableName } from './DbTableName';

describe('DbTableName', () => {
  it('rehydrates and splits with schema', () => {
    const result = DbTableName.rehydrate('public.tables');
    const dbTableName = result._unsafeUnwrap();
    const splitResult = dbTableName.split();
    splitResult._unsafeUnwrap();

    expect(splitResult._unsafeUnwrap()).toEqual({ schema: 'public', tableName: 'tables' });
  });

  it('uses default schema when missing', () => {
    const result = DbTableName.rehydrate('tables');
    const dbTableName = result._unsafeUnwrap();
    const splitResult = dbTableName.split({ defaultSchema: 'public' });
    splitResult._unsafeUnwrap();

    expect(splitResult._unsafeUnwrap()).toEqual({ schema: 'public', tableName: 'tables' });
  });

  it('rejects invalid values and empty access', () => {
    DbTableName.rehydrate('')._unsafeUnwrapErr();

    const empty = DbTableName.empty();
    const splitResult = empty.split();
    splitResult._unsafeUnwrapErr();
  });
});
