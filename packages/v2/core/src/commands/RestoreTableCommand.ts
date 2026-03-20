import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';

export const restoreTableInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
});

export type IRestoreTableCommandInput = z.input<typeof restoreTableInputSchema>;

export class RestoreTableCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId
  ) {}

  static create(raw: unknown): Result<RestoreTableCommand, DomainError> {
    const parsed = restoreTableInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid RestoreTableCommand input' }));

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map((tableId) => new RestoreTableCommand(baseId, tableId))
    );
  }
}
