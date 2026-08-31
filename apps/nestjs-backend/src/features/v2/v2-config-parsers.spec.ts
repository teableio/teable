import { describe, expect, it } from 'vitest';

import { resolveBoolean, resolvePositiveInteger } from './v2-config-parsers';

describe('v2 config parsers', () => {
  it('normalizes surrounding whitespace consistently', () => {
    expect(resolveBoolean(' false ', true)).toBe(false);
    expect(resolveBoolean(' true ')).toBe(true);
    expect(resolvePositiveInteger(' 42 ')).toBe(42);
  });

  it('uses explicit defaults for invalid values', () => {
    expect(resolveBoolean('invalid', true)).toBe(true);
    expect(resolvePositiveInteger('0')).toBeUndefined();
    expect(resolvePositiveInteger('invalid')).toBeUndefined();
  });
});
