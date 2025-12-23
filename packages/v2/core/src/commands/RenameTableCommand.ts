import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';

export const renameTableInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  name: z.string(),
});

export type IRenameTableCommandInput = z.input<typeof renameTableInputSchema>;

export class RenameTableCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly tableName: TableName
  ) {}

  static create(raw: unknown): Result<RenameTableCommand, string> {
    const parsed = renameTableInputSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid RenameTableCommand input');

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).andThen((tableId) =>
        TableName.create(parsed.data.name).map(
          (tableName) => new RenameTableCommand(baseId, tableId, tableName)
        )
      )
    );
  }
}
