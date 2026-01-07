import { describe, expect, it } from 'vitest';

import { TableSortKey } from './TableSortKey';

describe('TableSortKey', () => {
  it('validates sort keys', () => {
    const name = TableSortKey.create('name');
    const id = TableSortKey.create('id');
    const createdTime = TableSortKey.create('createdTime');
    const nameKey = name._unsafeUnwrap();
    const idKey = id._unsafeUnwrap();
    const createdTimeKey = createdTime._unsafeUnwrap();
    expect(nameKey.toString()).toBe('name');
    expect(idKey.toString()).toBe('id');
    expect(createdTimeKey.toString()).toBe('createdTime');
    TableSortKey.create('other')._unsafeUnwrapErr();
  });

  it('exposes helpers and equality', () => {
    const name = TableSortKey.name();
    const id = TableSortKey.id();
    const createdTime = TableSortKey.createdTime();
    expect(TableSortKey.default().toString()).toBe('createdTime');
    expect(name.equals(TableSortKey.from('name'))).toBe(true);
    expect(id.equals(TableSortKey.from('id'))).toBe(true);
    expect(createdTime.equals(TableSortKey.from('createdTime'))).toBe(true);
    expect(name.equals(id)).toBe(false);
  });
});
