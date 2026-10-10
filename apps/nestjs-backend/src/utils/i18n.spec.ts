import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getI18nPath } from './i18n.js';

describe('getI18nPath', () => {
  it('locates the locales directory relative to this module via import.meta.dirname', () => {
    const found = getI18nPath();
    expect(found).toBeDefined();
    expect(found).toMatch(/locales$/);
    expect(fs.existsSync(found!)).toBe(true);
  });
});
