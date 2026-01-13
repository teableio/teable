import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';

export const listBasesInputSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export type IListBasesQueryInput = z.input<typeof listBasesInputSchema>;
type IListBasesQueryOutput = z.output<typeof listBasesInputSchema>;

export class ListBasesQuery {
  private constructor(readonly pagination: OffsetPagination) {}

  static create(raw: unknown): Result<ListBasesQuery, DomainError> {
    const parsed = listBasesInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid ListBasesQuery input' }));

    return this.buildPagination(parsed.data).map((pagination) => new ListBasesQuery(pagination));
  }

  private static buildPagination(
    data: IListBasesQueryOutput
  ): Result<OffsetPagination, DomainError> {
    return PageLimit.create(data.limit).andThen((limit) =>
      PageOffset.create(data.offset).map((offset) => OffsetPagination.create(limit, offset))
    );
  }
}
