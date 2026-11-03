import type { SSRConfig } from 'next-i18next';
import { describe, expect, it } from 'vitest';
import { diffMissingKeys, getPluralCategories, pruneFallbackI18nStore } from './pruneFallbackStore';

const zh = getPluralCategories('zh');
const fr = getPluralCategories('fr');

describe('diffMissingKeys', () => {
  it('keeps only leaves the primary locale lacks', () => {
    const fallback = {
      a: 'A',
      b: 'B',
      nested: { c: 'C', d: 'D', deeper: { e: 'E', f: 'F' } },
      wholeBranch: { g: 'G' },
    };
    const primary = {
      a: '甲',
      nested: { c: '丙', deeper: { e: '戊' } },
    };
    expect(diffMissingKeys(fallback, primary, zh)).toEqual({
      b: 'B',
      nested: { d: 'D', deeper: { f: 'F' } },
      wholeBranch: { g: 'G' },
    });
  });

  it('drops a plural family the primary locale fully covers', () => {
    const fallback = { count_one: '{{count}} item', count_other: '{{count}} items' };
    // zh only has the `other` category.
    expect(diffMissingKeys(fallback, { count_other: '{{count}} 项' }, zh)).toEqual({});
  });

  it('keeps the whole fallback family when the primary misses a category it needs', () => {
    const fallback = { count_one: '{{count}} account', count_other: '{{count}} accounts' };
    // fr needs `many` (e.g. 1000000); without it i18next falls back to en `count_other`.
    const primary = { count_one: '{{count}} compte', count_other: '{{count}} comptes' };
    expect(diffMissingKeys(fallback, primary, fr)).toEqual(fallback);
    expect(
      diffMissingKeys(fallback, { ...primary, count_many: '{{count}} de comptes' }, fr)
    ).toEqual({});
  });

  it('does not count a bare primary key as covering the family', () => {
    // A direct `t('count_other', { count })` lookup skips the bare key.
    const fallback = { count_one: '{{count}} item', count_other: '{{count}} items' };
    expect(diffMissingKeys(fallback, { count: '{{count}} comptes' }, fr)).toEqual(fallback);
  });

  it('keeps every plural family for a locale the runtime does not know', () => {
    const fallback = { count_one: '1', count_other: 'n' };
    expect(diffMissingKeys(fallback, { count_other: 'x' }, null)).toEqual(fallback);
  });

  it('treats an empty string in the primary locale as translated', () => {
    expect(diffMissingKeys({ a: 'A' }, { a: '' }, zh)).toEqual({});
  });

  it('treats null in the primary locale as missing', () => {
    expect(diffMissingKeys({ a: 'A' }, { a: null }, zh)).toEqual({ a: 'A' });
  });

  it('returns everything when the primary locale is empty', () => {
    const fallback = { a: 'A', nested: { b: 'B' } };
    expect(diffMissingKeys(fallback, {}, zh)).toEqual(fallback);
  });
});

describe('pruneFallbackI18nStore', () => {
  it('trims fallback languages down to the missing keys and keeps empty namespaces', () => {
    const enCommon = { a: 'A', b: 'B' };
    const config: SSRConfig = {
      _nextI18Next: {
        initialLocale: 'zh',
        ns: ['common', 'table'],
        userConfig: null,
        initialI18nStore: {
          zh: { common: { a: '甲' }, table: { x: '戌' } },
          en: { common: enCommon, table: { x: 'X' } },
        },
      },
    };
    expect(pruneFallbackI18nStore(config)._nextI18Next?.initialI18nStore).toEqual({
      zh: { common: { a: '甲' }, table: { x: '戌' } },
      en: { common: { b: 'B' }, table: {} },
    });
    // The bundles are shared with the server's i18next resource store: never mutate them.
    expect(enCommon).toEqual({ a: 'A', b: 'B' });
  });

  it('leaves the store untouched when only the primary locale is present', () => {
    const config: SSRConfig = {
      _nextI18Next: {
        initialLocale: 'en',
        ns: ['common'],
        userConfig: null,
        initialI18nStore: { en: { common: { a: 'A' } } },
      },
    };
    expect(pruneFallbackI18nStore(config)._nextI18Next?.initialI18nStore).toEqual({
      en: { common: { a: 'A' } },
    });
  });

  it('is a no-op without translation props', () => {
    const config = {} as SSRConfig;
    expect(pruneFallbackI18nStore(config)).toBe(config);
  });
});
