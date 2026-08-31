import arSdk from '@teable/common-i18n/src/locales/ar/sdk.json';
import arTable from '@teable/common-i18n/src/locales/ar/table.json';
import deSdk from '@teable/common-i18n/src/locales/de/sdk.json';
import deTable from '@teable/common-i18n/src/locales/de/table.json';
import enSdk from '@teable/common-i18n/src/locales/en/sdk.json';
import enTable from '@teable/common-i18n/src/locales/en/table.json';
import esSdk from '@teable/common-i18n/src/locales/es/sdk.json';
import esTable from '@teable/common-i18n/src/locales/es/table.json';
import frSdk from '@teable/common-i18n/src/locales/fr/sdk.json';
import frTable from '@teable/common-i18n/src/locales/fr/table.json';
import heSdk from '@teable/common-i18n/src/locales/he/sdk.json';
import heTable from '@teable/common-i18n/src/locales/he/table.json';
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
import { HttpErrorCode } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkErrorI18nKeys, tableI18nKeys } from '../../../../i18n-keys/src';
import type { ILocaleFunction } from './i18n';
import { errorRequestHandler, getHttpErrorMessage, toCamelCaseErrorCode } from './queryClient';

vi.mock('@teable/ui-lib', () => ({
  sonner: { toast: { error: vi.fn(), warning: vi.fn() } },
}));

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
    ar: arTable,
    de: deTable,
    en: enTable,
    es: esTable,
    fr: frTable,
    he: heTable,
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
  const enLimitMessages = enSdk.httpErrors.limit;
  const expectedKeys = Object.keys(enLimitMessages).sort();
  const locales = {
    ar: arSdk,
    de: deSdk,
    en: enSdk,
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

  it.each(Object.entries(locales))(
    'covers all table data safety limit messages in %s',
    (_locale, sdk) => {
      expect(Object.keys(sdk.httpErrors.limit).sort()).toEqual(expectedKeys);
    }
  );

  it.each(Object.entries(locales).filter(([locale]) => locale !== 'en'))(
    'localizes all table data safety limit messages in %s',
    (_locale, sdk) => {
      const reusedEnglishKeys = expectedKeys.filter((key) => {
        const limitKey = key as keyof typeof enLimitMessages;
        return sdk.httpErrors.limit[limitKey] === enLimitMessages[limitKey];
      });
      expect(reusedEnglishKeys).toEqual([]);
    }
  );
});

describe('sdk v2 error message locale coverage', () => {
  const expectedKeys = collectLeafValues(sdkErrorI18nKeys);
  const locales = {
    ar: arSdk,
    de: deSdk,
    en: enSdk,
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

  const readMessage = (sdk: unknown, i18nKey: string): string | undefined => {
    const message = i18nKey
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], sdk);
    return typeof message === 'string' ? message : undefined;
  };

  const placeholdersOf = (message: string): string[] =>
    [...message.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort();

  it.each(Object.entries(locales))('covers all v2 error messages in %s', (_locale, sdk) => {
    expect(expectedKeys.filter((key) => !readMessage(sdk, key))).toEqual([]);
  });

  // Throw sites build the localization context from the English message's
  // placeholders; every translation must interpolate the same set or the
  // client-side lodash template throws and the toast is silently dropped.
  it.each(Object.entries(locales).filter(([locale]) => locale !== 'en'))(
    'uses the same interpolation placeholders as en in %s',
    (_locale, sdk) => {
      for (const key of expectedKeys) {
        expect(placeholdersOf(readMessage(sdk, key) ?? ''), key).toEqual(
          placeholdersOf(readMessage(enSdk, key) ?? '')
        );
      }
    }
  );
});

const t: ILocaleFunction = ((key: string, options?: Record<string, unknown>) => {
  if (key.endsWith('httpErrors.custom.recordFieldValueDuplicate')) {
    return `${key}:${options?.fieldName ?? ''}`;
  }
  if (key.endsWith('httpErrors.limit.nameMaxLength')) {
    return `${key}:${options?.max}`;
  }
  return key;
}) as ILocaleFunction;

describe('httpError code locale coverage', () => {
  const expectedKeys = Object.values(HttpErrorCode).map(toCamelCaseErrorCode).sort();
  const locales = {
    ar: arSdk,
    de: deSdk,
    en: enSdk,
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

  it.each(Object.entries(locales))('covers all HttpErrorCode titles in %s', (_locale, sdk) => {
    const missing = expectedKeys.filter(
      (key) => typeof sdk.httpErrors[key as keyof typeof sdk.httpErrors] !== 'string'
    );
    expect(missing).toEqual([]);
  });
});

describe('getHttpErrorMessage', () => {
  it('translates the localization the server attached', () => {
    const message = getHttpErrorMessage(
      {
        message: 'Cannot complete update: field fldEmail must have a unique value',
        data: {
          domainCode: 'validation.field.unique',
          details: { fieldId: 'fldEmail', fieldName: 'Email' },
          localization: {
            i18nKey: 'httpErrors.custom.recordFieldValueDuplicate',
            context: { fieldName: 'Email' },
          },
        },
      },
      t,
      'sdk'
    );

    expect(message).toBe('sdk:httpErrors.custom.recordFieldValueDuplicate:Email');
  });

  it('translates the localization without a namespace prefix', () => {
    const message = getHttpErrorMessage(
      {
        message: 'Cannot complete update: field fldEmail must have a unique value',
        data: {
          localization: {
            i18nKey: 'httpErrors.custom.recordFieldValueDuplicate',
            context: { fieldName: 'Email' },
          },
        },
      },
      t
    );

    expect(message).toBe('httpErrors.custom.recordFieldValueDuplicate:Email');
  });

  it('translates table data safety limit localizations', () => {
    const message = getHttpErrorMessage(
      {
        message: 'Table data safety limit exceeded: validation.limit.name_max_length',
        data: {
          domainCode: 'validation.limit.name_max_length',
          details: { attempted: 120, max: 100 },
          localization: { i18nKey: 'httpErrors.limit.nameMaxLength', context: { max: 100 } },
        },
      },
      t,
      'sdk'
    );

    expect(message).toBe('sdk:httpErrors.limit.nameMaxLength:100');
  });

  it('falls back to the server message when no localization is attached', () => {
    const message = getHttpErrorMessage(
      {
        message: 'fallback',
        data: { domainCode: 'validation.field.invalid_value', details: { fieldId: 'fldabc' } },
      },
      t,
      'sdk'
    );

    expect(message).toBe('fallback');
  });
});

describe('errorRequestHandler dedup', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let toastError: any;

  // Returns the options object (2nd arg) of every toast.error call.
  const errorCallOptions = (): { id?: string }[] =>
    toastError.mock.calls.map((call: unknown[]) => call[1] as { id?: string });

  beforeEach(async () => {
    const { sonner } = await import('@teable/ui-lib');
    toastError = sonner.toast.error;
    toastError.mockClear();
  });

  it('gives concurrent identical errors a single stable toast id', () => {
    const error = {
      code: 'internal_server_error',
      message: 'The gateway received an invalid response from the upstream server.',
      status: 502,
    };

    errorRequestHandler(error, t);
    errorRequestHandler(error, t);
    errorRequestHandler(error, t);

    expect(toastError).toHaveBeenCalledTimes(3);
    const ids = errorCallOptions().map((options) => options.id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBeTruthy();
  });

  it('gives a different error a different toast id', () => {
    errorRequestHandler({ code: 'internal_server_error', message: 'gateway boom', status: 502 }, t);
    errorRequestHandler({ code: 'bad_gateway', message: 'something else', status: 502 }, t);

    const [firstId, secondId] = errorCallOptions().map((options) => options.id);
    expect(firstId).not.toBe(secondId);
  });

  it('still passes a toast id on the no-translation fallback path', () => {
    errorRequestHandler({ code: 'internal_server_error', message: 'boom', status: 502 });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(errorCallOptions()[0].id).toBeTruthy();
  });
});
