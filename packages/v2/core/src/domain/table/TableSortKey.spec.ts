import { describe, expect, it } from 'vitest';

import { TableSortKey } from './TableSortKey';

describe('TableSortKey', () => {
  it('validates sort keys', () => {
    const name = TableSortKey.create('name');
    const id = TableSortKey.create('id');
    [name, id].forEach((r) => r._unsafeUnwrap());
    name._unsafeUnwrap();
    id._unsafeUnwrap();
    expect(name.value.toString()).toBe('name');
    expect(id.value.toString()).toBe('id');
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
