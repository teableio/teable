import deSdk from '@teable/common-i18n/src/locales/de/sdk.json';
import deTable from '@teable/common-i18n/src/locales/de/table.json';
import enSdk from '@teable/common-i18n/src/locales/en/sdk.json';
import enTable from '@teable/common-i18n/src/locales/en/table.json';
import esSdk from '@teable/common-i18n/src/locales/es/sdk.json';
import esTable from '@teable/common-i18n/src/locales/es/table.json';
import frSdk from '@teable/common-i18n/src/locales/fr/sdk.json';
import frTable from '@teable/common-i18n/src/locales/fr/table.json';
import itSdk from '@teable/common-i18n/src/locales/it/sdk.json';
import itTable from '@teable/common-i18n/src/locales/it/table.json';
import jaSdk from '@teable/common-i18n/src/locales/ja/sdk.json';
import jaTable from '@teable/common-i18n/src/locales/ja/table.json';
import ruSdk from '@teable/common-i18n/src/locales/ru/sdk.json';
import ruTable from '@teable/common-i18n/src/locales/ru/table.json';
import trSdk from '@teable/common-i18n/src/locales/tr/sdk.json';
import trTable from '@teable/common-i18n/src/locales/tr/table.json';
import ukSdk from '@teable/common-i18n/src/locales/uk/sdk.json';
import ukTable from '@teable/common-i18n/src/locales/uk/table.json';
import zhSdk from '@teable/common-i18n/src/locales/zh/sdk.json';
import zhTable from '@teable/common-i18n/src/locales/zh/table.json';
import { describe, expect, it } from 'vitest';
import { tableI18nKeys } from '../../../../i18n-keys/src';
import type { ILocaleFunction } from './i18n';
import { getHttpErrorMessage } from './queryClient';

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

describe('sdk table data safety limit locale coverage', () => {
  const expectedKeys = Object.keys(enSdk.httpErrors.limit).sort();
  const locales = {
    de: deSdk,
    en: enSdk,
    es: esSdk,
    fr: frSdk,
    it: itSdk,
    ja: jaSdk,
    ru: ruSdk,
    tr: trSdk,
    uk: ukSdk,
    zh: zhSdk,
  };

  it.each(Object.entries(locales))(
    'covers all table data safety limit messages in %s',
    (_locale, sdk) => {
      expect(Object.keys(sdk.httpErrors.limit).sort()).toEqual(expectedKeys);
    }
  );
});

const t: ILocaleFunction = ((key: string, options?: Record<string, unknown>) => {
  if (key === 'sdk:httpErrors.limit.nameMaxLength') {
    return `${key}:${options?.max}`;
  }
  return key;
}) as ILocaleFunction;

describe('getHttpErrorMessage', () => {
  it('localizes v2 table data safety validation limit errors by domain code', () => {
    const message = getHttpErrorMessage(
      {
        message: 'Table data safety limit exceeded: validation.limit.name_max_length',
        data: {
          domainCode: 'validation.limit.name_max_length',
          details: { max: 100 },
        },
      },
      t,
      'sdk'
    );

    expect(message).toBe('sdk:httpErrors.limit.nameMaxLength:100');
  });

  it('falls back to the server message for unknown validation limit keys', () => {
    const message = getHttpErrorMessage(
      {
        message: 'fallback',
        data: {
          domainCode: 'validation.limit.unknown_limit',
          details: { max: 1 },
        },
      },
      t,
      'sdk'
    );

    expect(message).toBe('fallback');
  });
});
