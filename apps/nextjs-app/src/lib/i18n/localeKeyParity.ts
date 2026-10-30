import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const SOURCE_LOCALE = 'en';

type IMessages = Map<string, unknown>;

export interface ILocaleKeyGap {
  locale: string;
  file: string;
  /** en keys the locale does not ship (plural families list each missing category). */
  missing: string[];
  /** Keys the locale ships that have no en counterpart. */
  extra: string[];
  /** Keys whose en copy is non-empty but the locale ships an empty string or a non-string. */
  empty: string[];
}

const flatten = (value: unknown, prefix = '', out: IMessages = new Map()) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      flatten(nested, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (prefix) {
    out.set(prefix, value);
  }
  return out;
};

const readMessages = (path: string): IMessages =>
  existsSync(path) ? flatten(JSON.parse(readFileSync(path, 'utf8'))) : new Map();

const listJsonFiles = (dir: string) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();

const findMissing = (source: IMessages, target: IMessages, categories: string[]) => {
  const pluralFamilies = new Set(
    [...source.keys()]
      .filter((key) => PLURAL_SUFFIX.test(key))
      .map((key) => key.replace(PLURAL_SUFFIX, ''))
  );
  const missingForms = (family: string) =>
    categories.map((category) => `${family}_${category}`).filter((key) => !target.has(key));

  const missingMessages = [...source.keys()].filter(
    (key) =>
      !PLURAL_SUFFIX.test(key) &&
      !target.has(key) &&
      // en sometimes ships one "{{count}} row(s)" message where a locale ships real plural
      // forms; i18next tries the suffixed keys first, so either shape counts as present —
      // unless en ships both shapes, where the bare key serves calls without a count.
      (pluralFamilies.has(key) || missingForms(key).length > 0)
  );
  const missingPluralForms = [...pluralFamilies].flatMap((family) =>
    // A single-category language (zh, ja) may ship one unsuffixed message for the family.
    categories.length === 1 && target.has(family) ? [] : missingForms(family)
  );
  return [...missingMessages, ...missingPluralForms].sort();
};

const findExtra = (source: IMessages, target: IMessages) => {
  // Every en message name with its plural suffix stripped: a locale may ship any plural
  // form, or a bare key, for a name en has in either shape.
  const sourceNames = new Set([...source.keys()].map((key) => key.replace(PLURAL_SUFFIX, '')));
  return [...target.keys()]
    .filter((key) => !source.has(key) && !sourceNames.has(key.replace(PLURAL_SUFFIX, '')))
    .sort();
};

const findEmpty = (source: IMessages, target: IMessages) =>
  [...target.entries()]
    .filter(([key, value]) => {
      const sourceValue = source.get(key);
      if (sourceValue === undefined) return false;
      if (typeof value !== 'string') return true;
      return value.trim() === '' && String(sourceValue).trim() !== '';
    })
    .map(([key]) => key);

/**
 * Compares every locale under `localesDir` (one folder per locale, one JSON file per
 * namespace) against en. Plural families are checked against the target locale's own
 * CLDR categories — ru needs `_few`/`_many`, ja only `_other` — because i18next picks
 * the suffix with the target locale's rules and falls back to en when one is missing.
 */
export const findLocaleKeyGaps = (localesDir: string): ILocaleKeyGap[] => {
  const locales = readdirSync(localesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== SOURCE_LOCALE)
    .map((entry) => entry.name)
    .sort();
  const sourceFiles = listJsonFiles(join(localesDir, SOURCE_LOCALE));
  const gaps: ILocaleKeyGap[] = [];

  for (const locale of locales) {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    const files = new Set([...sourceFiles, ...listJsonFiles(join(localesDir, locale))]);
    for (const file of files) {
      const source = readMessages(join(localesDir, SOURCE_LOCALE, file));
      const target = readMessages(join(localesDir, locale, file));
      const gap = {
        locale,
        file,
        missing: findMissing(source, target, categories),
        extra: findExtra(source, target),
        empty: findEmpty(source, target),
      };
      if (gap.missing.length || gap.extra.length || gap.empty.length) gaps.push(gap);
    }
  }
  return gaps;
};
