import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { DbTableName } from '../domain/table/DbTableName';
import { TableId } from '../domain/table/TableId';
import { TableUpdateCommand } from './TableUpdateCommand';

const inputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  dbTableName: z.string().regex(/^[a-z_]\w*\.[a-z_]\w{0,62}$/i),
});
export class RenameTableStorageCommand extends TableUpdateCommand {
  private constructor(
    baseId: BaseId,
    tableId: TableId,
    readonly dbTableName: DbTableName
  ) {
    super(baseId, tableId);
  }

  static create(raw: unknown): Result<RenameTableStorageCommand, DomainError> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid RenameTableStorageCommand input' }));
    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).andThen((tableId) =>
        DbTableName.rehydrate(parsed.data.dbTableName).map(
          (name) => new RenameTableStorageCommand(baseId, tableId, name)
        )
      )
    );
  }
}
