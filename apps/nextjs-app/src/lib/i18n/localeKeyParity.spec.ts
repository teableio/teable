import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findLocaleKeyGaps } from './localeKeyParity';

const commonLocalesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/common-i18n/src/locales'
);

const writeLocales = (files: Record<string, Record<string, unknown>>) => {
  const dir = mkdtempSync(join(tmpdir(), 'locale-parity-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(content));
  }
  return dir;
};

describe('common-i18n locales', () => {
  it('ship every en key in every locale, with no keys en does not have', () => {
    expect(findLocaleKeyGaps(commonLocalesDir)).toEqual([]);
  });
});

describe('findLocaleKeyGaps', () => {
  it('reports missing, extra and empty keys per locale and namespace', () => {
    const dir = writeLocales({
      'en/a.json': { title: 'Title', nested: { save: 'Save' }, blank: '' },
      'fr/a.json': { title: '', nested: {}, blank: '', stale: 'Old' },
    });
    expect(findLocaleKeyGaps(dir)).toEqual([
      {
        locale: 'fr',
        file: 'a.json',
        missing: ['nested.save'],
        extra: ['stale'],
        empty: ['title'],
      },
    ]);
  });

  it('reports a namespace file the locale does not ship at all', () => {
    const dir = writeLocales({
      'en/a.json': { x: 'X' },
      'en/b.json': { y: 'Y' },
      'de/a.json': { x: 'X' },
    });
    expect(findLocaleKeyGaps(dir)).toEqual([
      { locale: 'de', file: 'b.json', missing: ['y'], extra: [], empty: [] },
    ]);
  });

  it('checks plural families against the target locale categories', () => {
    const dir = writeLocales({
      'en/a.json': { row_one: '{{count}} row', row_other: '{{count}} rows' },
      'ru/a.json': { row_one: '1', row_few: '2', row_other: '5' },
      'ja/a.json': { row: '{{count}} 行' },
      'fr/a.json': { row_one: '1', row_many: 'm', row_other: 'o' },
    });
    expect(findLocaleKeyGaps(dir)).toEqual([
      { locale: 'ru', file: 'a.json', missing: ['row_many'], extra: [], empty: [] },
    ]);
  });

  it('accepts plural forms in place of an en message that has no plural suffix', () => {
    const dir = writeLocales({
      'en/a.json': { moved: '{{count}} node(s) moved' },
      'de/a.json': { moved_one: '{{count}} Knoten', moved_other: '{{count}} Knoten' },
      'ru/a.json': { moved_one: '1', moved_other: '5' },
    });
    expect(findLocaleKeyGaps(dir)).toEqual([
      { locale: 'ru', file: 'a.json', missing: ['moved'], extra: [], empty: [] },
    ]);
  });

  it('keeps a bare key that en ships next to its plural family', () => {
    const dir = writeLocales({
      'en/a.json': { count: 'Count', count_one: 'one', count_other: 'many' },
      'de/a.json': { count_one: 'eins', count_other: 'viele' },
    });
    expect(findLocaleKeyGaps(dir)).toEqual([
      { locale: 'de', file: 'a.json', missing: ['count'], extra: [], empty: [] },
    ]);
  });
});
