import type { SSRConfig } from 'next-i18next';

type ResourceTree = Record<string, unknown>;

const isTree = (value: unknown): value is ResourceTree =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const PLURAL_SUFFIX = /^(.+)_(ordinal_)?(zero|one|two|few|many|other)$/;

type PluralCategories = { cardinal: string[]; ordinal: string[] };

/** `null` when the runtime does not know the locale: every plural family is then kept. */
export const getPluralCategories = (lng: string): PluralCategories | null => {
  try {
    return {
      cardinal: new Intl.PluralRules(lng).resolvedOptions().pluralCategories,
      ordinal: new Intl.PluralRules(lng, { type: 'ordinal' }).resolvedOptions().pluralCategories,
    };
  } catch {
    return null;
  }
};

const isPresent = (value: unknown) => value !== undefined && value !== null;

/** `x_one` -> `{ family: 'x' }`, `x_ordinal_two` -> `{ family: 'x_ordinal', ordinal: true }`. */
const pluralFamilyOf = (key: string, value: unknown) => {
  const match = typeof value === 'string' ? PLURAL_SUFFIX.exec(key) : null;
  if (!match) return null;
  const ordinal = Boolean(match[2]);
  return { family: ordinal ? `${match[1]}_ordinal` : match[1], ordinal };
};

/**
 * A plural family (`key_one`, `key_other`, ...) is resolved in the fallback
 * language with the fallback's own plural rules, so its members cannot be
 * pruned one by one: `fr` defining `key_other` does not cover a count that
 * needs `fr` `key_many`, and that count then resolves to `en` `key_other`.
 * Returns the families the primary locale cannot answer for every count.
 */
const incompletePluralFamilies = (
  fallback: ResourceTree,
  primary: ResourceTree,
  categories: PluralCategories | null
): Set<string> => {
  const incomplete = new Set<string>();
  for (const key of Object.keys(fallback)) {
    const plural = pluralFamilyOf(key, fallback[key]);
    if (!plural || incomplete.has(plural.family)) continue;
    const required = categories && (plural.ordinal ? categories.ordinal : categories.cardinal);
    if (!required || required.some((c) => !isPresent(primary[`${plural.family}_${c}`]))) {
      incomplete.add(plural.family);
    }
  }
  return incomplete;
};

/** What of a non-plural fallback entry must ship, or `undefined` for nothing. */
const pruneEntry = (
  fallbackValue: unknown,
  primaryValue: unknown,
  categories: PluralCategories | null
): unknown => {
  if (!isPresent(primaryValue)) return fallbackValue;
  if (!isTree(fallbackValue) || !isTree(primaryValue)) return undefined;
  const nested = diffMissingKeys(fallbackValue, primaryValue, categories);
  return Object.keys(nested).length > 0 ? nested : undefined;
};

/**
 * Keep only the leaves of `fallback` that `primary` does not define.
 * i18next resolves a key in the primary language first and only consults
 * the fallback language when the key is missing there, so shipping the
 * missing subset is equivalent to shipping the whole fallback bundle.
 * Plural forms go or stay as a family: all of them when the primary locale
 * cannot answer every count itself, none otherwise.
 */
export const diffMissingKeys = (
  fallback: ResourceTree,
  primary: ResourceTree,
  categories: PluralCategories | null
): ResourceTree => {
  const result: ResourceTree = {};
  const keptFamilies = incompletePluralFamilies(fallback, primary, categories);
  for (const key of Object.keys(fallback)) {
    const plural = pluralFamilyOf(key, fallback[key]);
    if (plural) {
      if (keptFamilies.has(plural.family)) result[key] = fallback[key];
      continue;
    }
    const kept = pruneEntry(fallback[key], primary[key], categories);
    if (kept !== undefined) result[key] = kept;
  }
  return result;
};

/**
 * next-i18next's `serverSideTranslations` inlines every fallback language in
 * full next to the requested locale, which doubles the i18n payload in
 * `__NEXT_DATA__` / `_next/data` for every non-default-locale user. Trim the
 * fallback bundles down to the keys the requested locale actually lacks.
 *
 * Empty namespace objects are kept on purpose: i18next treats an existing
 * (language, namespace) bundle as loaded, so a client-side backend will not
 * re-fetch fallback bundles that are not needed.
 */
export const pruneFallbackI18nStore = (ssrConfig: SSRConfig): SSRConfig => {
  const nextI18Next = ssrConfig._nextI18Next;
  if (!nextI18Next) return ssrConfig;
  const { initialI18nStore, initialLocale } = nextI18Next;
  const primaryStore = initialI18nStore?.[initialLocale] as
    | Record<string, ResourceTree>
    | undefined;
  if (!primaryStore) return ssrConfig;
  const categories = getPluralCategories(initialLocale);

  for (const lng of Object.keys(initialI18nStore)) {
    if (lng === initialLocale) continue;
    const fallbackStore = initialI18nStore[lng] as Record<string, ResourceTree>;
    for (const ns of Object.keys(fallbackStore)) {
      fallbackStore[ns] = diffMissingKeys(
        fallbackStore[ns] ?? {},
        primaryStore[ns] ?? {},
        categories
      );
    }
  }
  return ssrConfig;
};
