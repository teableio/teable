import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../domain/shared/DomainError';

export const getComputedOutboxOverviewInputSchema = z.object({
  force: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true' || value === '1'),
});

export type IGetComputedOutboxOverviewQueryInput = z.input<
  typeof getComputedOutboxOverviewInputSchema
>;

export class GetComputedOutboxOverviewQuery {
  private constructor(readonly force: boolean) {}

  static create(raw: unknown = {}): Result<GetComputedOutboxOverviewQuery, DomainError> {
    const parsed = getComputedOutboxOverviewInputSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return err(
        domainError.validation({ message: 'Invalid GetComputedOutboxOverviewQuery input' })
      );
    }
    return ok(new GetComputedOutboxOverviewQuery(Boolean(parsed.data.force)));
  }
}
