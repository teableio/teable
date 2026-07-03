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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tableI18nKeys } from '../../../../i18n-keys/src';
import type { ILocaleFunction } from './i18n';
import { errorRequestHandler, getHttpErrorMessage } from './queryClient';

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
  const enLimitMessages = enSdk.httpErrors.limit;
  const expectedKeys = Object.keys(enLimitMessages).sort();
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

describe('sdk validation error locale coverage', () => {
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
    'covers unique field validation message in %s',
    (_locale, sdk) => {
      expect(sdk.httpErrors.validation.field.unique).toBeTruthy();
    }
  );
});

const t: ILocaleFunction = ((key: string, options?: Record<string, unknown>) => {
  if (key === 'httpErrors.validation.field.unique') {
    return `${key}:${options?.fieldName ?? ''}`;
  }
  if (key === 'sdk:httpErrors.limit.nameMaxLength') {
    return `${key}:${options?.max}`;
  }
  if (key === 'sdk:httpErrors.validation.field.unique') {
    return `${key}:${options?.fieldName ?? ''}`;
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

  it('localizes v2 validation errors by domain code', () => {
    const message = getHttpErrorMessage(
      {
        message: 'Cannot complete update: field fldEmail must have a unique value',
        data: {
          domainCode: 'validation.field.unique',
          details: { fieldName: 'Email' },
        },
      },
      t,
      'sdk'
    );

    expect(message).toBe('sdk:httpErrors.validation.field.unique:Email');
  });

  it('localizes v2 validation errors by domain code without namespace prefix', () => {
    const message = getHttpErrorMessage(
      {
        message: 'Cannot complete update: field fldEmail must have a unique value',
        data: {
          domainCode: 'validation.field.unique',
          details: { fieldName: 'Email' },
        },
      },
      t
    );

    expect(message).toBe('httpErrors.validation.field.unique:Email');
  });

  it('falls back to the server message for unknown domain code keys', () => {
    const message = getHttpErrorMessage(
      {
        message: 'fallback',
        data: {
          domainCode: 'validation.field.unknown',
        },
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
