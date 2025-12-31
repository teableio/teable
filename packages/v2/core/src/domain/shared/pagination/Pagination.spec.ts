import { describe, expect, it } from 'vitest';

import { OffsetPagination } from './OffsetPagination';
import { PageLimit } from './PageLimit';
import { PageOffset } from './PageOffset';

describe('PageLimit', () => {
  it('validates limits', () => {
    const limit = PageLimit.create(10);
    const other = PageLimit.create(10);
    const limitValue = limit._unsafeUnwrap();
    const otherValue = other._unsafeUnwrap();
    expect(limitValue.toNumber()).toBe(10);
    expect(limitValue.equals(otherValue)).toBe(true);
    PageLimit.create(0)._unsafeUnwrapErr();
    PageLimit.create(-1)._unsafeUnwrapErr();
  });
});

describe('PageOffset', () => {
  it('validates offsets', () => {
    const offset = PageOffset.create(5);
    const other = PageOffset.create(5);
    const offsetValue = offset._unsafeUnwrap();
    const otherValue = other._unsafeUnwrap();
    expect(offsetValue.toNumber()).toBe(5);
    expect(offsetValue.equals(otherValue)).toBe(true);
    PageOffset.create(-1)._unsafeUnwrapErr();
  });

  it('provides zero helper', () => {
    expect(PageOffset.zero().toNumber()).toBe(0);
  });
});

describe('OffsetPagination', () => {
  it('wraps limit and offset', () => {
    const limitResult = PageLimit.create(20);
    const offsetResult = PageOffset.create(10);
    [limitResult, offsetResult].forEach((r) => r._unsafeUnwrap());
    limitResult._unsafeUnwrap();
    offsetResult._unsafeUnwrap();
    const pagination = OffsetPagination.create(
      limitResult._unsafeUnwrap(),
      offsetResult._unsafeUnwrap()
    );
    expect(pagination.limit()).toBe(limitResult._unsafeUnwrap());
    expect(pagination.offset()).toBe(offsetResult._unsafeUnwrap());

    const withDefaultOffset = OffsetPagination.create(limitResult._unsafeUnwrap());
    expect(withDefaultOffset.offset().toNumber()).toBe(0);
  });
});
