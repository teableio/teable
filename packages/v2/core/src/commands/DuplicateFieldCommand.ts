import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';
import { TableUpdateCommand } from './TableUpdateCommand';

export const duplicateFieldInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  fieldId: z.string(),
  includeRecordValues: z.boolean().default(true),
  newFieldName: z.string().optional(),
});

export type IDuplicateFieldCommandInput = z.input<typeof duplicateFieldInputSchema>;

export class DuplicateFieldCommand extends TableUpdateCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly fieldId: FieldId,
    readonly includeRecordValues: boolean,
    readonly newFieldName: string | undefined
  ) {
    super(baseId, tableId);
  }

  static create(raw: unknown): Result<DuplicateFieldCommand, DomainError> {
    const parsed = duplicateFieldInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid DuplicateFieldCommand input',
          details: z.formatError(parsed.error),
        })
      );

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).andThen((tableId) =>
        FieldId.create(parsed.data.fieldId).map(
          (fieldId) =>
            new DuplicateFieldCommand(
              baseId,
              tableId,
              fieldId,
              parsed.data.includeRecordValues,
              parsed.data.newFieldName
            )
        )
      )
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    // Foreign table references are resolved during handler execution
    // since we need to read the source field first to determine its type
    return ok([]);
  }
}
