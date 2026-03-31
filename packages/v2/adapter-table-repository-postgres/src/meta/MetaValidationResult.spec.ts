import { describe, expect, it } from 'vitest';

import {
  createIssue,
  infoIssue,
  referenceError,
  referenceSuccess,
  schemaError,
  schemaSuccess,
  warningIssue,
} from './MetaValidationResult';

describe('MetaValidationResult helpers', () => {
  it('creates raw issues with optional details', () => {
    expect(
      createIssue({
        fieldId: 'fld1',
        fieldName: 'Field 1',
        fieldType: 'text',
        category: 'schema',
        severity: 'warning',
        message: 'problem',
        details: { path: 'options.value' },
      })
    ).toEqual({
      fieldId: 'fld1',
      fieldName: 'Field 1',
      fieldType: 'text',
      category: 'schema',
      severity: 'warning',
      message: 'problem',
      details: { path: 'options.value' },
    });
  });

  it('builds reference and schema errors with the expected detail payloads', () => {
    expect(
      referenceError({
        fieldId: 'fld2',
        fieldName: 'Link',
        fieldType: 'link',
        message: 'missing foreign table',
        relatedTableId: 'tbl1',
        relatedFieldId: 'fld9',
      })
    ).toMatchObject({
      category: 'reference',
      severity: 'error',
      details: {
        relatedTableId: 'tbl1',
        relatedFieldId: 'fld9',
      },
    });

    expect(
      schemaError({
        fieldId: 'fld3',
        fieldName: 'Rating',
        fieldType: 'rating',
        message: 'invalid max',
        path: 'options.max',
        expected: '1-10',
        received: '100',
      })
    ).toMatchObject({
      category: 'schema',
      severity: 'error',
      details: {
        path: 'options.max',
        expected: '1-10',
        received: '100',
      },
    });
  });

  it('builds warning/info/success variants with the right categories', () => {
    expect(
      warningIssue({
        fieldId: 'fld4',
        fieldName: 'Lookup',
        fieldType: 'lookup',
        category: 'reference',
        message: 'warning',
      })
    ).toMatchObject({
      category: 'reference',
      severity: 'warning',
      message: 'warning',
    });

    expect(
      infoIssue({
        fieldId: 'fld5',
        fieldName: 'Formula',
        fieldType: 'formula',
        category: 'schema',
        message: 'info',
      })
    ).toMatchObject({
      category: 'schema',
      severity: 'info',
      message: 'info',
    });

    expect(
      referenceSuccess({
        fieldId: 'fld6',
        fieldName: 'Link',
        fieldType: 'link',
        message: 'ok',
        relatedTableId: 'tbl2',
      })
    ).toMatchObject({
      category: 'reference',
      severity: 'info',
      details: { relatedTableId: 'tbl2' },
    });

    expect(
      schemaSuccess({
        fieldId: 'fld7',
        fieldName: 'Text',
        fieldType: 'singleLineText',
        message: 'ok',
        path: 'config',
      })
    ).toEqual({
      fieldId: 'fld7',
      fieldName: 'Text',
      fieldType: 'singleLineText',
      category: 'schema',
      severity: 'info',
      message: 'ok',
      details: { path: 'config' },
    });
  });
});
