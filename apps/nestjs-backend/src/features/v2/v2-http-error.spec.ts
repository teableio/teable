import { HttpStatus } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { mapDomainErrorToHttpError } from '@teable/v2-contract-http';
import { domainError } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import { throwV2Error } from './v2-http-error';

describe('throwV2Error', () => {
  it('passes the throw-site localization through to the HTTP exception', () => {
    let caught: CustomHttpException | undefined;
    try {
      throwV2Error(
        {
          code: 'validation.field.not_null',
          message: 'Cannot set null: field "Number" violates not-null constraint',
          tags: ['validation'],
          details: { fieldId: 'fldabc', fieldName: 'Number' },
          localization: {
            i18nKey: 'httpErrors.custom.recordFieldValueNotNull',
            context: { fieldName: 'Number' },
          },
        },
        HttpStatus.BAD_REQUEST
      );
    } catch (error) {
      caught = error as CustomHttpException;
    }

    expect(caught).toBeInstanceOf(CustomHttpException);
    expect(caught?.code).toBe(HttpErrorCode.VALIDATION_ERROR);
    expect(caught?.data).toEqual({
      domainCode: 'validation.field.not_null',
      domainTags: ['validation'],
      details: { fieldId: 'fldabc', fieldName: 'Number' },
      localization: {
        i18nKey: 'httpErrors.custom.recordFieldValueNotNull',
        context: { fieldName: 'Number' },
      },
    });
  });

  it('leaves localization undefined for errors that carry none', () => {
    let caught: CustomHttpException | undefined;
    try {
      throwV2Error(
        { code: 'validation.field.invalid_value', message: 'Invalid value' },
        HttpStatus.BAD_REQUEST
      );
    } catch (error) {
      caught = error as CustomHttpException;
    }

    expect(caught?.data?.localization).toBeUndefined();
  });

  it('reattaches DomainError creation stack onto the thrown HTTP exception', () => {
    const domain = domainError.infrastructure({
      message: 'Failed to load compute activity',
      details: { tableId: 'tbl1', error: 'connection refused' },
    });
    const mapped = mapDomainErrorToHttpError(domain);

    // HTTP body stays clean — stack is non-enumerable.
    expect(JSON.parse(JSON.stringify(mapped))).toEqual({
      code: 'infrastructure',
      message: 'Failed to load compute activity',
      tags: ['infrastructure'],
      details: { tableId: 'tbl1', error: 'connection refused' },
    });
    expect(mapped.stack).toBe(domain.stack);

    let caught: CustomHttpException | undefined;
    try {
      throwV2Error(mapped, HttpStatus.INTERNAL_SERVER_ERROR);
    } catch (error) {
      caught = error as CustomHttpException;
    }

    expect(caught).toBeInstanceOf(CustomHttpException);
    expect(caught?.stack).toBe(domain.stack);
    expect(caught?.stack).toEqual(expect.stringContaining('v2-http-error.spec.ts'));
  });
});
