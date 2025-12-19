import { describe, expect, it } from 'vitest';

import { generatePrefixedId, getRandomString, prefixedIdRegex, RandomType } from './IdGenerator';

describe('IdGenerator', () => {
  it('generates alphanumeric strings with the requested length', () => {
    const value = getRandomString(16);
    expect(value).toHaveLength(16);
    expect(value).toMatch(/^[0-9a-z]+$/i);
  });

  it('generates numeric strings when requested', () => {
    const value = getRandomString(12, RandomType.Number);
    expect(value).toHaveLength(12);
    // eslint-disable-next-line regexp/prefer-d
    expect(value).toMatch(/^[0-9]+$/);
  });

  it('generates prefixed ids that match the expected pattern', () => {
    const prefix = 'tbl';
    const length = 16;
    const id = generatePrefixedId(prefix, length);
    expect(id).toMatch(prefixedIdRegex(prefix, length));
  });
});
