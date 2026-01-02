import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { recordFilterSchema, type RecordFilter } from './RecordFilterDto';

export const listTableRecordsInputSchema = z.object({
  tableId: z.string(),
  filter: recordFilterSchema.optional(),
});

export type IListTableRecordsQueryInput = z.input<typeof listTableRecordsInputSchema>;

export class ListTableRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly filter: RecordFilter | null | undefined
  ) {}

  static create(raw: unknown): Result<ListTableRecordsQuery, DomainError> {
    const parsed = listTableRecordsInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid ListTableRecordsQuery input' }));

    return TableId.create(parsed.data.tableId).map(
      (tableId) => new ListTableRecordsQuery(tableId, parsed.data.filter)
    );
  }
}
