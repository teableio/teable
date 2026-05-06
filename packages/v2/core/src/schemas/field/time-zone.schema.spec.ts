import { describe, expect, it } from 'vitest';

import { TimeFormatting } from '../../domain/table/fields/types/DateTimeFormatting';
import { dateFormattingSchema } from './common.schema';
import {
  conditionalRollupOptionsSchema,
  formulaOptionsSchema,
  rollupOptionsSchema,
} from './tableField.schema';

describe('field timezone schemas', () => {
  it('accepts known IANA aliases in field option schemas', () => {
    expect(
      dateFormattingSchema.parse({
        date: 'YYYY-MM-DD',
        time: TimeFormatting.None,
        timeZone: 'Asia/Saigon',
      }).timeZone
    ).toBe('Asia/Saigon');

    expect(
      formulaOptionsSchema.parse({
        expression: 'NOW()',
        timeZone: 'Asia/Saigon',
      }).timeZone
    ).toBe('Asia/Saigon');

    expect(
      rollupOptionsSchema.parse({
        expression: 'COUNTALL(values)',
        timeZone: 'Asia/Saigon',
      }).timeZone
    ).toBe('Asia/Saigon');

    expect(
      conditionalRollupOptionsSchema.parse({
        expression: 'COUNTALL(values)',
        timeZone: 'Asia/Saigon',
      }).timeZone
    ).toBe('Asia/Saigon');
  });

  it('still rejects invalid timezone values', () => {
    expect(() =>
      dateFormattingSchema.parse({
        date: 'YYYY-MM-DD',
        time: TimeFormatting.None,
        timeZone: 'Invalid/Zone',
      })
    ).toThrow();
  });
});
