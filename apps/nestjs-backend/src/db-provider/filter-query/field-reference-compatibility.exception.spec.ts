import enSdk from '@teable/common-i18n/src/locales/en/sdk.json';
import jaSdk from '@teable/common-i18n/src/locales/ja/sdk.json';
import zhSdk from '@teable/common-i18n/src/locales/zh/sdk.json';
import { FieldReferenceCompatibilityException } from './cell-value-filter.abstract';

describe('FieldReferenceCompatibilityException', () => {
  it('carries a localized httpErrors key with reference/source names (T7960)', () => {
    const error = new FieldReferenceCompatibilityException('数量', '阈值');
    expect(error.data?.localization).toEqual({
      i18nKey: 'httpErrors.filter.fieldReferenceIncompatible',
      context: { reference: '阈值', source: '数量' },
    });
  });

  it('has the fieldReferenceIncompatible copy in en/zh/ja (T7960)', () => {
    for (const sdk of [enSdk, zhSdk, jaSdk] as Array<{
      httpErrors?: { filter?: Record<string, string> };
    }>) {
      expect(sdk.httpErrors?.filter?.fieldReferenceIncompatible).toBeTruthy();
    }
  });
});
