import { describe, expect, it } from 'vitest';

import { Sort } from './Sort';
import { SortDirection } from './SortDirection';

describe('SortDirection', () => {
  it('validates directions and helpers', () => {
    const asc = SortDirection.create('asc');
    const desc = SortDirection.create('desc');
    const ascValue = asc._unsafeUnwrap();
    const descValue = desc._unsafeUnwrap();
    expect(ascValue.toString()).toBe('asc');
    expect(descValue.toString()).toBe('desc');
    expect(SortDirection.from('asc').toString()).toBe('asc');
    expect(SortDirection.asc().toString()).toBe('asc');
    expect(SortDirection.desc().toString()).toBe('desc');
    expect(ascValue.equals(descValue)).toBe(false);
    SortDirection.create('up')._unsafeUnwrapErr();
  });
});

describe('Sort', () => {
  it('rejects empty sort', () => {
    const result = Sort.create([]);
    result._unsafeUnwrapErr();
  });

  it('creates and exposes fields', () => {
    const directionResult = SortDirection.create('asc');
    directionResult._unsafeUnwrap();

    const sortResult = Sort.create([{ key: 'name', direction: directionResult._unsafeUnwrap() }]);
    sortResult._unsafeUnwrap();

    const sort = sortResult._unsafeUnwrap();
    expect(sort.isEmpty()).toBe(false);
    const fields = [...sort.fields()];
    expect(fields).toEqual([{ key: 'name', direction: directionResult._unsafeUnwrap() }]);
    fields.push({ key: 'id', direction: directionResult._unsafeUnwrap() });
    expect(sort.fields().length).toBe(1);
  });

  it('supports empty sorts', () => {
    const empty = Sort.empty<string>();
    expect(empty.isEmpty()).toBe(true);
    expect(empty.fields()).toEqual([]);
  });
});
