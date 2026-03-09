import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';
import { TableUpdateCommand } from './TableUpdateCommand';

export const deleteFieldsInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  fieldIds: z.array(z.string()).min(1),
});

export type IDeleteFieldsCommandInput = z.input<typeof deleteFieldsInputSchema>;

export class DeleteFieldsCommand extends TableUpdateCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly fieldIds: ReadonlyArray<FieldId>
  ) {
    super(baseId, tableId);
  }

  static create(raw: unknown): Result<DeleteFieldsCommand, DomainError> {
    const parsed = deleteFieldsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DeleteFieldsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).andThen((tableId) =>
        createFieldIds(parsed.data.fieldIds).map(
          (fieldIds) => new DeleteFieldsCommand(baseId, tableId, dedupeFieldIds(fieldIds))
        )
      )
    );
  }
}

const createFieldIds = (
  fieldIds: ReadonlyArray<string>
): Result<ReadonlyArray<FieldId>, DomainError> => {
  const values: FieldId[] = [];
  for (const fieldId of fieldIds) {
    const fieldIdResult = FieldId.create(fieldId);
    if (fieldIdResult.isErr()) {
      return err(fieldIdResult.error);
    }
    values.push(fieldIdResult.value);
  }
  return ok(values);
};

const dedupeFieldIds = (fieldIds: ReadonlyArray<FieldId>): ReadonlyArray<FieldId> => {
  const seen = new Set<string>();
  const deduped: FieldId[] = [];
  for (const fieldId of fieldIds) {
    const value = fieldId.toString();
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(fieldId);
  }
  return deduped;
};
