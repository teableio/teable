import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';
import type { ViewColumnMetaPatch } from '../domain/table/views/ViewColumnMeta';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

const columnMetaPatchSchema = z
  .object({
    order: z.number().optional(),
    visible: z.boolean().optional(),
    hidden: z.boolean().optional(),
    width: z.number().optional(),
    required: z.boolean().optional(),
    statisticFunc: z.string().nullable().optional(),
  })
  .strict();

export const updateViewColumnMetaInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  columnMeta: z.array(
    z.object({
      fieldId: z.string(),
      columnMeta: columnMetaPatchSchema,
    })
  ),
});

export type IUpdateViewColumnMetaCommandInput = z.input<typeof updateViewColumnMetaInputSchema>;

export class UpdateViewColumnMetaCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly patches: ReadonlyArray<ViewColumnMetaPatch>
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateViewColumnMetaCommand, DomainError> {
    const parsed = updateViewColumnMetaInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateViewColumnMetaCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).andThen((viewId) => {
        const patches: ViewColumnMetaPatch[] = [];
        for (const patch of parsed.data.columnMeta) {
          const fieldIdResult = FieldId.create(patch.fieldId);
          if (fieldIdResult.isErr()) return err(fieldIdResult.error);
          patches.push({
            fieldId: fieldIdResult.value,
            columnMeta: { ...patch.columnMeta },
          });
        }
        return ok(new UpdateViewColumnMetaCommand(tableId, viewId, patches));
      })
    );
  }
}
