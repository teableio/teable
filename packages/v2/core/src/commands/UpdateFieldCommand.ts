import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { TableId } from '../domain/table/TableId';

/**
 * Schema for field update input.
 * All fields are optional since we only update what's provided.
 * baseId is not required - table can be found by tableId alone.
 */
export const updateFieldInputSchema = z.object({
  tableId: z.string(),
  fieldId: z.string(),
  field: z.object({
    // Type conversion (optional)
    type: z.string().optional(),
    // Common properties
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    dbFieldName: z.string().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
    // Type-specific options (partial)
    options: z.record(z.string(), z.unknown()).optional(),
    // For rollup/conditionalRollup
    config: z.record(z.string(), z.unknown()).optional(),
    // For rating field (legacy support)
    max: z.number().optional(),
    // For conditional rollup / lookup result type conversion
    cellValueType: z.string().optional(),
    isMultipleCellValue: z.boolean().optional(),
    // v1-compatible sidecar metadata persisted in field.ai_config
    aiConfig: z.unknown().nullable().optional(),
    // Convert flow can request replacement semantics for option patches
    replaceOptions: z.boolean().optional(),
  }),
});

export type IUpdateFieldCommandInput = z.input<typeof updateFieldInputSchema>;
export type IFieldUpdateInput = z.output<typeof updateFieldInputSchema>['field'];

export class UpdateFieldCommand {
  private constructor(
    readonly tableId: TableId,
    readonly fieldId: FieldId,
    readonly fieldUpdate: IFieldUpdateInput,
    readonly allowNoop: boolean
  ) {}

  static create(
    raw: unknown,
    options?: {
      allowNoop?: boolean;
    }
  ): Result<UpdateFieldCommand, DomainError> {
    const parsed = updateFieldInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid UpdateFieldCommand input',
          details: z.formatError(parsed.error),
        })
      );

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      FieldId.create(parsed.data.fieldId).map(
        (fieldId) =>
          new UpdateFieldCommand(tableId, fieldId, parsed.data.field, options?.allowNoop ?? false)
      )
    );
  }

  /**
   * Get foreign table references needed for this update.
   * Returns empty array for simple field types.
   * For link field updates, returns the foreign table reference from options.
   */
  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const command = this;
    return safeTry<ReadonlyArray<LinkForeignTableReference>, DomainError>(function* () {
      const references: LinkForeignTableReference[] = [];

      // Extract foreign table reference from link field options
      if (command.fieldUpdate.options && typeof command.fieldUpdate.options === 'object') {
        const options = command.fieldUpdate.options as { foreignTableId?: string; baseId?: string };
        if (options.foreignTableId) {
          const foreignTableId = yield* TableId.create(options.foreignTableId);
          const baseId = options.baseId ? yield* BaseId.create(options.baseId) : undefined;
          references.push({
            foreignTableId,
            baseId,
          });
        }
      }

      // Extract foreign table reference from config (conditionalRollup/rollup)
      if (command.fieldUpdate.config && typeof command.fieldUpdate.config === 'object') {
        const config = command.fieldUpdate.config as { foreignTableId?: string; baseId?: string };
        if (config.foreignTableId) {
          const foreignTableId = yield* TableId.create(config.foreignTableId);
          const baseId = config.baseId ? yield* BaseId.create(config.baseId) : undefined;
          references.push({
            foreignTableId,
            baseId,
          });
        }
      }

      return ok(references);
    });
  }
}
