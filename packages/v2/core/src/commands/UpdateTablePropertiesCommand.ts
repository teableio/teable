import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { DEFAULT_TABLE_DATA_SAFETY_LIMITS } from '../domain/shared/TableDataSafetyLimits';
import { TableId } from '../domain/table/TableId';
import type { TablePropertiesPatch } from '../domain/table/TableProperties';
import { TableProperties } from '../domain/table/TableProperties';
import { TableUpdateCommand } from './TableUpdateCommand';

export const updateTablePropertiesInputSchema = z
  .object({
    baseId: z.string(),
    tableId: z.string(),
    description: z
      .string()
      .max(DEFAULT_TABLE_DATA_SAFETY_LIMITS.displayText.maxDescriptionLength)
      .nullable()
      .optional(),
    icon: z.string().emoji().nullable().optional(),
  })
  .strict()
  .refine((value) => 'description' in value || 'icon' in value, {
    message: 'At least one table property is required',
  });

export type IUpdateTablePropertiesCommandInput = z.input<typeof updateTablePropertiesInputSchema>;

export class UpdateTablePropertiesCommand extends TableUpdateCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly patch: TablePropertiesPatch
  ) {
    super(baseId, tableId);
  }

  static create(raw: unknown): Result<UpdateTablePropertiesCommand, DomainError> {
    const parsed = updateTablePropertiesInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateTablePropertiesCommand input',
          details: { issues: parsed.error.issues },
        })
      );
    }

    const patch: TablePropertiesPatch = {
      ...('description' in parsed.data ? { description: parsed.data.description } : {}),
      ...('icon' in parsed.data ? { icon: parsed.data.icon } : {}),
    };

    return TableProperties.empty()
      .withPatch(patch)
      .andThen(() =>
        BaseId.create(parsed.data.baseId).andThen((baseId) =>
          TableId.create(parsed.data.tableId).map(
            (tableId) => new UpdateTablePropertiesCommand(baseId, tableId, patch)
          )
        )
      );
  }
}
