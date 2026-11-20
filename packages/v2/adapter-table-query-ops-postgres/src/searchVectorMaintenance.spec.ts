import { describe, expect, it } from 'vitest';

import { isSearchMaintenanceWindow } from './searchVectorMaintenance';

describe('UTC search maintenance window', () => {
  it.each([undefined, '', 'bad', '24:00-02:00', '01:60-02:00', '02:00-02:00'])(
    'does not authorize expansion for %s',
    (window) =>
      expect(isSearchMaintenanceWindow(window, new Date('2026-11-13T01:30:00Z'))).toBe(false)
  );

  it.each([
    ['01:00-02:00', '01:00', true],
    ['01:00-02:00', '01:59', true],
    ['01:00-02:00', '02:00', false],
    ['23:00-02:00', '23:00', true],
    ['23:00-02:00', '00:00', true],
    ['23:00-02:00', '02:00', false],
    ['23:00-02:00', '22:59', false],
  ] as const)('evaluates %s at %s as %s', (window, time, expected) => {
    expect(isSearchMaintenanceWindow(window, new Date(`2026-11-13T${time}:00Z`))).toBe(expected);
  });
});
