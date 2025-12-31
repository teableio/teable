import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';
import { TableUpdateCommand } from './TableUpdateCommand';

export const deleteFieldInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  fieldId: z.string(),
});

export type IDeleteFieldCommandInput = z.input<typeof deleteFieldInputSchema>;

export class DeleteFieldCommand extends TableUpdateCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly fieldId: FieldId
  ) {
    super(baseId, tableId);
  }

  static create(raw: unknown): Result<DeleteFieldCommand, DomainError> {
    const parsed = deleteFieldInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid DeleteFieldCommand input',
          details: z.formatError(parsed.error),
        })
      );

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).andThen((tableId) =>
        FieldId.create(parsed.data.fieldId).map(
          (fieldId) => new DeleteFieldCommand(baseId, tableId, fieldId)
        )
      )
    );
  }
}
