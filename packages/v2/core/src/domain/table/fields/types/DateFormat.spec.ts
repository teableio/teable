import { describe, expect, it } from 'vitest';

import { DateFormat } from './DateFormat';

describe('DateFormat', () => {
  it('accepts valid formats', () => {
    DateFormat.create('date')._unsafeUnwrap();
    DateFormat.create('dateTime')._unsafeUnwrap();
  });

  it('rejects invalid formats', () => {
    DateFormat.create('datetime')._unsafeUnwrapErr();
    DateFormat.create(123)._unsafeUnwrapErr();
  });

  it('provides helpers', () => {
    expect(DateFormat.date().toString()).toBe('date');
    expect(DateFormat.dateTime().toString()).toBe('dateTime');
  });

  it('compares formats by value', () => {
    const left = DateFormat.create('date');
    const right = DateFormat.create('date');
    const leftValue = left._unsafeUnwrap();
    const rightValue = right._unsafeUnwrap();
    expect(leftValue.equals(rightValue)).toBe(true);
  });
});
