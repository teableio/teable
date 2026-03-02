import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { TableId } from '../domain/table/TableId';
import { tableFieldInputSchema } from '../schemas/field';
import { parseTableFieldSpec, resolveTableFieldInputName } from './TableFieldSpecs';
import { TableUpdateCommand } from './TableUpdateCommand';

export const createFieldInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  field: tableFieldInputSchema,
  order: z
    .object({
      viewId: z.string(),
      orderIndex: z.number(),
    })
    .optional(),
});

export type ICreateFieldCommandInput = z.input<typeof createFieldInputSchema>;

export class CreateFieldCommand extends TableUpdateCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly field: z.output<typeof tableFieldInputSchema>,
    readonly order?: {
      viewId: string;
      orderIndex: number;
    }
  ) {
    super(baseId, tableId);
  }

  static create(raw: unknown): Result<CreateFieldCommand, DomainError> {
    const parsed = createFieldInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid CreateFieldCommand input',
          details: z.formatError(parsed.error),
        })
      );

    if (parsed.data.field.isPrimary === true) {
      return err(
        domainError.unexpected({
          message: 'CreateFieldCommand does not support primary field updates',
        })
      );
    }

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map(
        (tableId) => new CreateFieldCommand(baseId, tableId, parsed.data.field, parsed.data.order)
      )
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    if (this.field.type === 'link') {
      const baseIdRaw = this.field.options.baseId;
      return TableId.create(this.field.options.foreignTableId).andThen((foreignTableId) =>
        baseIdRaw
          ? BaseId.create(baseIdRaw).map((baseId) => [{ foreignTableId, baseId }])
          : ok([{ foreignTableId }])
      );
    }

    return resolveTableFieldInputName(this.field, []).andThen((resolved) =>
      parseTableFieldSpec(resolved, { isPrimary: false }).andThen((spec) =>
        spec.foreignTableReferences()
      )
    );
  }
}
