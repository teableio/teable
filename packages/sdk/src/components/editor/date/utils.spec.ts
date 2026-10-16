import { TimeFormatting } from '@teable/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertZonedInputToUtc } from './utils';

describe('convertZonedInputToUtc T7825', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores a typed date-only value as field-zone midnight, not the current clock', () => {
    vi.useFakeTimers({ now: new Date('2026-03-15T09:58:55.000Z') });

    expect(
      convertZonedInputToUtc('2026-03-15', {
        date: 'YYYY-MM-DD',
        time: TimeFormatting.None,
        timeZone: 'Asia/Shanghai',
      })
    ).toBe('2026-03-14T16:00:00.000Z');
  });

  it('keeps an explicit clock when the field shows time', () => {
    expect(
      convertZonedInputToUtc('2026-03-15 13:45', {
        date: 'YYYY-MM-DD',
        time: TimeFormatting.Hour24,
        timeZone: 'Asia/Shanghai',
      })
    ).toBe('2026-03-15T05:45:00.000Z');
  });
});
