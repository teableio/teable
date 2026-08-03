import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';

export const getComputeActivityInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
});

export type IGetComputeActivityQueryInput = z.input<typeof getComputeActivityInputSchema>;

export class GetComputeActivityQuery {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId
  ) {}

  static create(raw: unknown): Result<GetComputeActivityQuery, DomainError> {
    const parsed = getComputeActivityInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid GetComputeActivityQuery input' }));
    }

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map(
        (tableId) => new GetComputeActivityQuery(baseId, tableId)
      )
    );
  }
}
