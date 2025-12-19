import { describe, expect, it } from 'vitest';

import { DateFormat } from './DateFormat';

describe('DateFormat', () => {
  it('accepts valid formats', () => {
    expect(DateFormat.create('date').isOk()).toBe(true);
    expect(DateFormat.create('dateTime').isOk()).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(DateFormat.create('datetime').isErr()).toBe(true);
    expect(DateFormat.create(123).isErr()).toBe(true);
  });

  it('provides helpers', () => {
    expect(DateFormat.date().toString()).toBe('date');
    expect(DateFormat.dateTime().toString()).toBe('dateTime');
  });
});
