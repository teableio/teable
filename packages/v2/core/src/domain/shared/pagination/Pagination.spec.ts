import { describe, expect, it } from 'vitest';

import { OffsetPagination } from './OffsetPagination';
import { PageLimit } from './PageLimit';
import { PageOffset } from './PageOffset';

describe('PageLimit', () => {
  it('validates limits', () => {
    const limit = PageLimit.create(10);
    const other = PageLimit.create(10);
    expect([limit, other].every((r) => r.isOk())).toBe(true);
    if (limit.isErr() || other.isErr()) return;
    expect(limit.value.toNumber()).toBe(10);
    expect(limit.value.equals(other.value)).toBe(true);
    expect(PageLimit.create(0).isErr()).toBe(true);
    expect(PageLimit.create(-1).isErr()).toBe(true);
  });
});

describe('PageOffset', () => {
  it('validates offsets', () => {
    const offset = PageOffset.create(5);
    const other = PageOffset.create(5);
    expect([offset, other].every((r) => r.isOk())).toBe(true);
    if (offset.isErr() || other.isErr()) return;
    expect(offset.value.toNumber()).toBe(5);
    expect(offset.value.equals(other.value)).toBe(true);
    expect(PageOffset.create(-1).isErr()).toBe(true);
  });

  it('provides zero helper', () => {
    expect(PageOffset.zero().toNumber()).toBe(0);
  });
});

describe('OffsetPagination', () => {
  it('wraps limit and offset', () => {
    const limitResult = PageLimit.create(20);
    const offsetResult = PageOffset.create(10);
    expect([limitResult, offsetResult].every((r) => r.isOk())).toBe(true);
    if (limitResult.isErr() || offsetResult.isErr()) return;
    const pagination = OffsetPagination.create(limitResult.value, offsetResult.value);
    expect(pagination.limit()).toBe(limitResult.value);
    expect(pagination.offset()).toBe(offsetResult.value);

    const withDefaultOffset = OffsetPagination.create(limitResult.value);
    expect(withDefaultOffset.offset().toNumber()).toBe(0);
  });
});
