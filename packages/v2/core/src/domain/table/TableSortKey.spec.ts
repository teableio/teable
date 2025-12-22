import { describe, expect, it } from 'vitest';

import { TableSortKey } from './TableSortKey';

describe('TableSortKey', () => {
  it('validates sort keys', () => {
    const name = TableSortKey.create('name');
    const id = TableSortKey.create('id');
    expect([name, id].every((r) => r.isOk())).toBe(true);
    if (name.isErr() || id.isErr()) return;
    expect(name.value.toString()).toBe('name');
    expect(id.value.toString()).toBe('id');
    expect(TableSortKey.create('other').isErr()).toBe(true);
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
