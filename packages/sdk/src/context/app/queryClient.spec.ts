import deTable from '@teable/common-i18n/src/locales/de/table.json';
import enTable from '@teable/common-i18n/src/locales/en/table.json';
import esTable from '@teable/common-i18n/src/locales/es/table.json';
import frTable from '@teable/common-i18n/src/locales/fr/table.json';
import itTable from '@teable/common-i18n/src/locales/it/table.json';
import jaTable from '@teable/common-i18n/src/locales/ja/table.json';
import ruTable from '@teable/common-i18n/src/locales/ru/table.json';
import trTable from '@teable/common-i18n/src/locales/tr/table.json';
import ukTable from '@teable/common-i18n/src/locales/uk/table.json';
import zhTable from '@teable/common-i18n/src/locales/zh/table.json';
import { describe, expect, it } from 'vitest';
import { tableI18nKeys } from '../../../../i18n-keys/src';

const collectLeafKeys = (value: unknown, prefix = ''): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      return collectLeafKeys(nestedValue, nextKey);
    }
    return nextKey;
  });
};

const collectLeafValues = (value: unknown): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.values(value).flatMap((nestedValue) => {
    if (typeof nestedValue === 'string') {
      return [nestedValue];
    }
    return collectLeafValues(nestedValue);
  });
};

describe('table locale coverage', () => {
  const expectedKeys = collectLeafValues(tableI18nKeys);
  const locales = {
    de: deTable,
    en: enTable,
    es: esTable,
    fr: frTable,
    it: itTable,
    ja: jaTable,
    ru: ruTable,
    tr: trTable,
    uk: ukTable,
    zh: zhTable,
  };

  it.each(Object.entries(locales))('covers all public table i18n keys in %s', (_locale, table) => {
    const localeKeys = new Set(collectLeafKeys(table));
    expect(expectedKeys.filter((key) => !localeKeys.has(key))).toEqual([]);
  });
});
