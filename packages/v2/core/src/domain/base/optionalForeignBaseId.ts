import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { DomainError } from '../shared/DomainError';
import { BaseId } from './BaseId';

/**
 * Optional cross-base id. Empty string and null mean same-base.
 * Keep `.optional()` outermost so object input treats `baseId` as an
 * optional key instead of a required unknown preprocess input.
 */
export const optionalForeignBaseIdSchema = z
  .union([z.string().min(1), z.literal(''), z.null()])
  .transform((value) => (value === '' || value === null ? undefined : value))
  .optional();

export const parseOptionalForeignBaseId = (
  value: unknown
): Result<BaseId | undefined, DomainError> => {
  if (value === undefined || value === null || value === '') {
    return ok(undefined);
  }
  return BaseId.create(value);
};

export const optionalBaseIdsEqual = (
  left: BaseId | undefined,
  right: BaseId | undefined
): boolean => (left == null ? right == null : right != null && left.equals(right));
