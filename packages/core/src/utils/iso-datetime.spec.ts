import { isoDateTimeSchema } from './iso-datetime';

describe('isoDateTimeSchema', () => {
  it('accepts second and minute precision with a Z suffix', () => {
    const schema = isoDateTimeSchema();
    expect(schema.safeParse('2024-01-01T06:15:30.123Z').success).toBe(true);
    expect(schema.safeParse('2024-01-01T06:15:30Z').success).toBe(true);
    expect(schema.safeParse('2024-01-01T06:15Z').success).toBe(true);
  });

  it('accepts an offset only when offset is enabled', () => {
    expect(isoDateTimeSchema().safeParse('2024-01-01T14:15:30+08:00').success).toBe(false);
    expect(isoDateTimeSchema({ offset: true }).safeParse('2024-01-01T14:15:30+08:00').success).toBe(
      true
    );
    expect(isoDateTimeSchema({ offset: true }).safeParse('2024-01-01T14:15+08:00').success).toBe(
      true
    );
  });

  it('rejects values without a time or a timezone', () => {
    const schema = isoDateTimeSchema({ offset: true });
    expect(schema.safeParse('2024-01-01').success).toBe(false);
    expect(schema.safeParse('2024-01-01T06:15:30').success).toBe(false);
    expect(schema.safeParse('2024-01-01T06Z').success).toBe(false);
  });
});
