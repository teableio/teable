import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { TableId } from '../domain/table/TableId';

export const listTableRecordsInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
});

export type IListTableRecordsQueryInput = z.input<typeof listTableRecordsInputSchema>;

export class ListTableRecordsQuery {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId
  ) {}

  static create(raw: unknown): Result<ListTableRecordsQuery, string> {
    const parsed = listTableRecordsInputSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid ListTableRecordsQuery input');

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map(
        (tableId) => new ListTableRecordsQuery(baseId, tableId)
      )
    );
  }
}
