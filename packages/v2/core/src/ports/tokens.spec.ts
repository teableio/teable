import { describe, expect, it } from 'vitest';

import { v2CoreTokens } from './tokens';

describe('v2CoreTokens', () => {
  it('defines unique symbols', () => {
    const values = Object.values(v2CoreTokens);
    expect(values.every((value) => typeof value === 'symbol')).toBe(true);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });
});
