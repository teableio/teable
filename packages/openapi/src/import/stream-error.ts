import type { ILocalization } from '@teable/core';
import { HttpError, HttpErrorCode } from '@teable/core';

export const createImportStreamError = (event: {
  message: string;
  code?: string;
  localization?: ILocalization;
}): HttpError => {
  const isValidation = event.code?.includes('validation') || event.code?.startsWith('import.');
  const isLimit =
    event.code?.includes('rowsPerTableMax') ||
    event.code === 'table_data_safety.rows_per_table_max';
  return new HttpError(
    {
      message: event.message,
      code: isLimit
        ? HttpErrorCode.PAYMENT_REQUIRED
        : isValidation
          ? HttpErrorCode.VALIDATION_ERROR
          : HttpErrorCode.INTERNAL_SERVER_ERROR,
      data: {
        domainCode: event.code,
        ...(event.localization && { localization: event.localization }),
      },
    },
    isLimit ? 402 : isValidation ? 400 : 500
  );
};
