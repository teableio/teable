import { describe, expect, it } from 'vitest';

import { TableSortKey } from './TableSortKey';

describe('TableSortKey', () => {
  it('validates sort keys', () => {
    const name = TableSortKey.create('name');
    const id = TableSortKey.create('id');
    const nameKey = name._unsafeUnwrap();
    const idKey = id._unsafeUnwrap();
    expect(nameKey.toString()).toBe('name');
    expect(idKey.toString()).toBe('id');
    TableSortKey.create('other')._unsafeUnwrapErr();
  });

  it('exposes helpers and equality', () => {
    const name = TableSortKey.name();
    const id = TableSortKey.id();
    expect(TableSortKey.default().toString()).toBe('name');
    expect(name.equals(TableSortKey.from('name'))).toBe(true);
    expect(id.equals(TableSortKey.from('id'))).toBe(true);
    expect(name.equals(id)).toBe(false);
  });
});
