import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';

export const deleteTableModeSchema = z.enum(['soft', 'permanent']);

export const deleteTableInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  mode: deleteTableModeSchema.default('soft'),
});

export type IDeleteTableCommandInput = z.input<typeof deleteTableInputSchema>;
export type DeleteTableMode = z.infer<typeof deleteTableModeSchema>;

export class DeleteTableCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly mode: DeleteTableMode
  ) {}

  static create(raw: unknown): Result<DeleteTableCommand, DomainError> {
    const parsed = deleteTableInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid DeleteTableCommand input' }));

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map(
        (tableId) => new DeleteTableCommand(baseId, tableId, parsed.data.mode)
      )
    );
  }
}
