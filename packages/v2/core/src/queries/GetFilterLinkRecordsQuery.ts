import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import {
  viewSourceFilterSchema,
  type ViewSourceFilterDTO,
} from '../domain/table/views/ViewSourceFilter';

export const getFilterLinkRecordsInputSchema = z.object({
  tableId: z.string(),
  filter: viewSourceFilterSchema.optional(),
});

export type IGetFilterLinkRecordsQueryInput = z.input<typeof getFilterLinkRecordsInputSchema>;

export class GetFilterLinkRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly filter: ViewSourceFilterDTO | null
  ) {}

  static create(raw: unknown): Result<GetFilterLinkRecordsQuery, DomainError> {
    const parsed = getFilterLinkRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid GetFilterLinkRecordsQuery input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).map(
      (tableId) => new GetFilterLinkRecordsQuery(tableId, parsed.data.filter ?? null)
    );
  }
}
