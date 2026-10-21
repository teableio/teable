import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';

export const getDefaultViewIdInputSchema = z.object({
  tableId: z.string(),
});

export type IGetDefaultViewIdQueryInput = z.input<typeof getDefaultViewIdInputSchema>;

export class GetDefaultViewIdQuery {
  private constructor(readonly tableId: TableId) {}

  static create(raw: unknown): Result<GetDefaultViewIdQuery, DomainError> {
    const parsed = getDefaultViewIdInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid GetDefaultViewIdQuery input' }));
    }

    return TableId.create(parsed.data.tableId).map((tableId) => new GetDefaultViewIdQuery(tableId));
  }
}
