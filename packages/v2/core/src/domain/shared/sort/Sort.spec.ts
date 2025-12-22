import { describe, expect, it } from 'vitest';

import { Sort } from './Sort';
import { SortDirection } from './SortDirection';

describe('SortDirection', () => {
  it('validates directions and helpers', () => {
    const asc = SortDirection.create('asc');
    const desc = SortDirection.create('desc');
    expect([asc, desc].every((r) => r.isOk())).toBe(true);
    if (asc.isErr() || desc.isErr()) return;
    expect(asc.value.toString()).toBe('asc');
    expect(desc.value.toString()).toBe('desc');
    expect(SortDirection.from('asc').toString()).toBe('asc');
    expect(SortDirection.asc().toString()).toBe('asc');
    expect(SortDirection.desc().toString()).toBe('desc');
    expect(asc.value.equals(desc.value)).toBe(false);
    expect(SortDirection.create('up').isErr()).toBe(true);
  });
});

describe('Sort', () => {
  it('rejects empty sort', () => {
    const result = Sort.create([]);
    expect(result.isErr()).toBe(true);
  });

  it('creates and exposes fields', () => {
    const directionResult = SortDirection.create('asc');
    expect(directionResult.isOk()).toBe(true);
    if (directionResult.isErr()) return;

    const sortResult = Sort.create([{ key: 'name', direction: directionResult.value }]);
    expect(sortResult.isOk()).toBe(true);
    if (sortResult.isErr()) return;

    const sort = sortResult.value;
    expect(sort.isEmpty()).toBe(false);
    const fields = [...sort.fields()];
    expect(fields).toEqual([{ key: 'name', direction: directionResult.value }]);
    fields.push({ key: 'id', direction: directionResult.value });
    expect(sort.fields().length).toBe(1);
  });

  it('supports empty sorts', () => {
    const empty = Sort.empty<string>();
    expect(empty.isEmpty()).toBe(true);
    expect(empty.fields()).toEqual([]);
  });
});
