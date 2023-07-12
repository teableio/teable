/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INumberFormatting } from './number';
import { formatNumberToString } from './number';

describe('formatNumberToString', () => {
  it('should correctly format number string with precision', () => {
    const num = 1234.5678;
    const formatting: INumberFormatting = { precision: 2 };
    expect(formatNumberToString(num, formatting)).toBe('1234.57');
  });

  it('should return empty string for null', () => {
    const num = null;
    expect(formatNumberToString(num as any, { precision: 2 })).toBe('');
  });

  it('should correctly format integer', () => {
    const num = 1234;
    const formatting: INumberFormatting = { precision: 0 };
    expect(formatNumberToString(num, formatting)).toBe('1234');
  });
});
