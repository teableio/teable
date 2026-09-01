import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../domain/shared/DomainError';

export const searchComputedOutboxPauseSpacesInputSchema = z.object({
  search: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export type ISearchComputedOutboxPauseSpacesQueryInput = z.input<
  typeof searchComputedOutboxPauseSpacesInputSchema
>;

export class SearchComputedOutboxPauseSpacesQuery {
  private constructor(
    readonly search: string,
    readonly limit: number
  ) {}

  static create(raw: unknown): Result<SearchComputedOutboxPauseSpacesQuery, DomainError> {
    const parsed = searchComputedOutboxPauseSpacesInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({ message: 'Invalid SearchComputedOutboxPauseSpacesQuery input' })
      );
    }
    return ok(new SearchComputedOutboxPauseSpacesQuery(parsed.data.search, parsed.data.limit));
  }
}
