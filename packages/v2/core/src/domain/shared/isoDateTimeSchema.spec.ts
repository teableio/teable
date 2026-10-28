import { describe, expect, it } from 'vitest';

import { isoDateTimeWithOffsetSchema } from './isoDateTimeSchema';

describe('isoDateTimeWithOffsetSchema', () => {
  const schema = isoDateTimeWithOffsetSchema();

  it('accepts second and minute precision with a Z or an offset', () => {
    expect(schema.safeParse('2024-01-01T06:15:30.123Z').success).toBe(true);
    expect(schema.safeParse('2024-01-01T06:15Z').success).toBe(true);
    expect(schema.safeParse('2024-01-01T14:15:30+08:00').success).toBe(true);
    expect(schema.safeParse('2024-01-01T14:15+08:00').success).toBe(true);
  });

  it('rejects values without a time or a timezone', () => {
    expect(schema.safeParse('2024-01-01').success).toBe(false);
    expect(schema.safeParse('2024-01-01T06:15:30').success).toBe(false);
  });
});
