import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';

export const getTableByIdInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
});

export type IGetTableByIdQueryInput = z.input<typeof getTableByIdInputSchema>;

export class GetTableByIdQuery {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId
  ) {}

  static create(raw: unknown): Result<GetTableByIdQuery, DomainError> {
    const parsed = getTableByIdInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid GetTableByIdQuery input' }));

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map((tableId) => new GetTableByIdQuery(baseId, tableId))
    );
  }
}
