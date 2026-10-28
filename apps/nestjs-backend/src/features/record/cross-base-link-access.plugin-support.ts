import { HttpStatus } from '@nestjs/common';
import { domainError, type DomainError, type IDomainErrorLocalization } from '@teable/v2-core';
import type { CustomHttpException } from '../../custom.exception';
import { CROSS_BASE_LINK_FOREIGN_TABLE_READ_FORBIDDEN } from './cross-base-link-access.service';

/**
 * The host checks throw `CustomHttpException` for a v1 caller, which is also
 * what the Nest route surfaces. A v2 plugin has to return a domain error
 * instead, otherwise the plugin runner wraps it as an unexpected failure and
 * the status becomes 500. Keep the caller-visible contract by carrying the
 * original message and `localization` over.
 *
 * `CrossBaseLinkAccessService` denies with 403; the same-space rule in
 * `FieldSupplementService` is a validation error (400).
 */
export const toCrossBaseLinkDomainError = (
  error: CustomHttpException,
  details: Readonly<Record<string, unknown>>
): DomainError => {
  const localization = error.data?.localization as IDomainErrorLocalization | undefined;
  const params = {
    message: error.message,
    details,
    ...(localization ? { localization } : {}),
    cause: error,
  };

  return error.getStatus() === HttpStatus.FORBIDDEN
    ? domainError.forbidden({
        ...params,
        code: CROSS_BASE_LINK_FOREIGN_TABLE_READ_FORBIDDEN,
      })
    : domainError.validation({
        ...params,
        code: 'cross_base_link.cross_space_target_forbidden',
      });
};
