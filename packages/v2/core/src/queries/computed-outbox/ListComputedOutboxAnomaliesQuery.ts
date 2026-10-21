import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { computedOutboxAnomalyKinds } from '../../domain/computed/outbox';
import { domainError, type DomainError } from '../../domain/shared/DomainError';

export const listComputedOutboxAnomaliesInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  q: z.string().trim().max(500).optional(),
  kind: z.enum(computedOutboxAnomalyKinds).optional(),
});

export type IListComputedOutboxAnomaliesQueryInput = z.input<
  typeof listComputedOutboxAnomaliesInputSchema
>;

export class ListComputedOutboxAnomaliesQuery {
  private constructor(
    readonly limit: number,
    readonly q: string | undefined,
    readonly kind: (typeof computedOutboxAnomalyKinds)[number] | undefined
  ) {}

  static create(raw: unknown = {}): Result<ListComputedOutboxAnomaliesQuery, DomainError> {
    const parsed = listComputedOutboxAnomaliesInputSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return err(
        domainError.validation({ message: 'Invalid ListComputedOutboxAnomaliesQuery input' })
      );
    }
    return ok(
      new ListComputedOutboxAnomaliesQuery(parsed.data.limit, parsed.data.q, parsed.data.kind)
    );
  }
}
