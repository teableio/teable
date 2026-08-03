import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';

export const duplicateTableInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  name: z.string(),
  includeRecords: z.boolean().default(false),
});

export type IDuplicateTableCommandInput = z.input<typeof duplicateTableInputSchema>;

export class DuplicateTableCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly name: TableName,
    readonly includeRecords: boolean
  ) {}

  static create(raw: unknown): Result<DuplicateTableCommand, DomainError> {
    const parsed = duplicateTableInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DuplicateTableCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).andThen((tableId) =>
        TableName.create(parsed.data.name).map(
          (name) => new DuplicateTableCommand(baseId, tableId, name, parsed.data.includeRecords)
        )
      )
    );
  }
}
