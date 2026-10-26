import arSdk from '@teable/common-i18n/src/locales/ar/sdk.json';
import deSdk from '@teable/common-i18n/src/locales/de/sdk.json';
import enSdk from '@teable/common-i18n/src/locales/en/sdk.json';
import esSdk from '@teable/common-i18n/src/locales/es/sdk.json';
import frSdk from '@teable/common-i18n/src/locales/fr/sdk.json';
import heSdk from '@teable/common-i18n/src/locales/he/sdk.json';
import itSdk from '@teable/common-i18n/src/locales/it/sdk.json';
import jaSdk from '@teable/common-i18n/src/locales/ja/sdk.json';
import ruSdk from '@teable/common-i18n/src/locales/ru/sdk.json';
import trSdk from '@teable/common-i18n/src/locales/tr/sdk.json';
import ukSdk from '@teable/common-i18n/src/locales/uk/sdk.json';
import zhSdk from '@teable/common-i18n/src/locales/zh/sdk.json';
import { describe, expect, it } from 'vitest';

// The client merges the active language over en, so a missing or untranslated key
// silently falls back to English instead of failing anywhere visible.
const locales: Record<string, unknown> = {
  ar: arSdk,
  de: deSdk,
  es: esSdk,
  fr: frSdk,
  he: heSdk,
  it: itSdk,
  ja: jaSdk,
  ru: ruSdk,
  tr: trSdk,
  uk: ukSdk,
  zh: zhSdk,
};

// Values that are legitimately identical to English in a given language (brand names etc.)
const SAME_AS_ENGLISH_ALLOWED: Record<string, string[]> = {};

const flatten = (value: unknown, prefix = ''): Record<string, string> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).reduce(
      (acc, [key, nested]) => ({ ...acc, ...flatten(nested, prefix ? `${prefix}.${key}` : key) }),
      {}
    );
  }
  return prefix ? { [prefix]: String(value) } : {};
};

const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]))].sort();

// Nothing left to translate once the placeholders and punctuation are gone
const isPlaceholderOnly = (text: string) => !text.replace(/\{\{\s*\w+\s*\}\}|[\W_]/g, '');

const english = flatten((enSdk as { httpErrors: unknown }).httpErrors);
const byLocale = Object.entries(locales).map(([locale, sdk]) => ({
  locale,
  messages: flatten((sdk as { httpErrors: unknown }).httpErrors),
}));

describe('sdk httpErrors locales', () => {
  it('has the same keys in every locale as in en', () => {
    expect(Object.keys(english).length).toBeGreaterThan(600);
    const drift = byLocale
      .map(({ locale, messages }) => ({
        locale,
        missing: Object.keys(english).filter((key) => !messages[key]?.trim()),
        extra: Object.keys(messages).filter((key) => !(key in english)),
      }))
      .filter(({ missing, extra }) => missing.length || extra.length);
    expect(drift).toEqual([]);
  });

  it('keeps the en placeholders in every translation', () => {
    const mismatched = byLocale.flatMap(({ locale, messages }) =>
      Object.keys(english)
        .filter((key) => key in messages)
        .filter((key) => placeholders(english[key]).join() !== placeholders(messages[key]).join())
        .map((key) => `${locale}:${key}`)
    );
    expect(mismatched).toEqual([]);
  });

  it('has no entry left in English', () => {
    const untranslated = byLocale.flatMap(({ locale, messages }) =>
      Object.keys(english)
        .filter((key) => messages[key] === english[key] && !isPlaceholderOnly(english[key]))
        .filter((key) => !SAME_AS_ENGLISH_ALLOWED[locale]?.includes(key))
        .map((key) => `${locale}:${key}`)
    );
    expect(untranslated).toEqual([]);
  });
});
