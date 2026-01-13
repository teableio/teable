import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { TableId } from '../domain/table/TableId';
import { tableFieldInputSchema } from '../schemas/field';
import type { ITableFieldInput } from '../schemas/field';
import { parseTableFieldSpec, resolveTableFieldInputName } from './TableFieldSpecs';
import { TableUpdateCommand } from './TableUpdateCommand';

export const createFieldInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  field: tableFieldInputSchema,
});

export type ICreateFieldCommandInput = z.input<typeof createFieldInputSchema>;

export class CreateFieldCommand extends TableUpdateCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly field: ITableFieldInput
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
        (tableId) => new CreateFieldCommand(baseId, tableId, parsed.data.field)
      )
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return resolveTableFieldInputName(this.field, []).andThen((resolved) =>
      parseTableFieldSpec(resolved, { isPrimary: false }).andThen((spec) =>
        spec.foreignTableReferences()
      )
    );
  }
}
