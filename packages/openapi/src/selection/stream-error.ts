import type { ILocalization } from '@teable/core';
import { HttpError, HttpErrorCode } from '@teable/core';

/**
 * Convert the last SSE error event of a selection stream into the error the
 * client function throws. An `HttpError` carries the event's `localization`
 * (and domain code) in `data`, so callers translating with
 * `getHttpErrorMessage` show the localized text instead of the English
 * fallback message.
 *
 * The status is synthetic — the SSE response itself was 200 — so it is
 * classified from the domain code: validation errors are the user's to fix
 * (400), anything else (e.g. infrastructure failures) is a server error (500).
 */
export const createSelectionStreamError = (event: {
  message: string;
  code?: string;
  localization?: ILocalization;
}): HttpError => {
  const isValidation = event.code?.startsWith('validation.') ?? false;
  return new HttpError(
    {
      message: event.message,
      code: isValidation ? HttpErrorCode.VALIDATION_ERROR : HttpErrorCode.INTERNAL_SERVER_ERROR,
      data: {
        domainCode: event.code,
        ...(event.localization && { localization: event.localization }),
      },
    },
    isValidation ? 400 : 500
  );
};
