import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { TableId } from '../domain/table/TableId';
import type { ITableFieldInput } from './TableFieldSpecs';
import { tableFieldInputSchema } from './TableFieldSpecs';

export const createFieldInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  field: tableFieldInputSchema,
});

export type ICreateFieldCommandInput = z.input<typeof createFieldInputSchema>;

export class CreateFieldCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly field: ITableFieldInput
  ) {}

  static create(raw: unknown): Result<CreateFieldCommand, string> {
    const parsed = createFieldInputSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid CreateFieldCommand input');

    if (parsed.data.field.isPrimary === true) {
      return err('CreateFieldCommand does not support primary field updates');
    }

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map(
        (tableId) => new CreateFieldCommand(baseId, tableId, parsed.data.field)
      )
    );
  }
}
