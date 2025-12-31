import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { recordFilterSchema, type RecordFilter } from './RecordFilterDto';

export const listTableRecordsInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  filter: recordFilterSchema.optional(),
});

export type IListTableRecordsQueryInput = z.input<typeof listTableRecordsInputSchema>;

export class ListTableRecordsQuery {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly filter: RecordFilter | null | undefined
  ) {}

  static create(raw: unknown): Result<ListTableRecordsQuery, DomainError> {
    const parsed = listTableRecordsInputSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.fromMessage('Invalid ListTableRecordsQuery input'));

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map(
        (tableId) => new ListTableRecordsQuery(baseId, tableId, parsed.data.filter)
      )
    );
  }
}
