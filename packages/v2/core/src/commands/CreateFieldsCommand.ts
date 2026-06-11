import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { TableId } from '../domain/table/TableId';
import { tableFieldInputSchema } from '../schemas/field';
import { parseTableFieldSpec, resolveTableFieldInputName } from './TableFieldSpecs';
import { TableUpdateCommand } from './TableUpdateCommand';

export const createFieldsInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  fields: z.array(tableFieldInputSchema).min(1),
});

export type ICreateFieldsCommandInput = z.input<typeof createFieldsInputSchema>;

const dedupeForeignTableReferences = (
  references: ReadonlyArray<LinkForeignTableReference>
): ReadonlyArray<LinkForeignTableReference> => {
  const seen = new Set<string>();
  const deduped: LinkForeignTableReference[] = [];

  for (const reference of references) {
    const baseKey = reference.baseId ? reference.baseId.toString() : 'local';
    const key = `${baseKey}:${reference.foreignTableId.toString()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(reference);
  }

  return deduped;
};

const collectDuplicateFieldIds = (
  fields: ReadonlyArray<z.output<typeof tableFieldInputSchema>>
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const field of fields) {
    if (!field.id) {
      continue;
    }
    if (seen.has(field.id)) {
      duplicates.add(field.id);
      continue;
    }
    seen.add(field.id);
  }

  return [...duplicates];
};

export class CreateFieldsCommand extends TableUpdateCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly fields: ReadonlyArray<z.output<typeof tableFieldInputSchema>>
  ) {
    super(baseId, tableId);
  }

  static create(raw: unknown): Result<CreateFieldsCommand, DomainError> {
    const parsed = createFieldsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid CreateFieldsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    if (parsed.data.fields.some((field) => field.isPrimary === true)) {
      return err(
        domainError.unexpected({
          message: 'CreateFieldsCommand does not support primary field updates',
        })
      );
    }

    const duplicateFieldIds = collectDuplicateFieldIds(parsed.data.fields);
    if (duplicateFieldIds.length > 0) {
      return err(
        domainError.validation({
          message: 'Duplicate fieldId in CreateFieldsCommand input',
          details: { duplicateFieldIds },
        })
      );
    }

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map(
        (tableId) => new CreateFieldsCommand(baseId, tableId, [...parsed.data.fields])
      )
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const references: LinkForeignTableReference[] = [];

    for (const field of this.fields) {
      if (field.type === 'link') {
        const baseIdRaw = field.options.baseId;
        const foreignTableIdResult = TableId.create(field.options.foreignTableId);
        if (foreignTableIdResult.isErr()) {
          return err(foreignTableIdResult.error);
        }

        if (baseIdRaw) {
          const baseIdResult = BaseId.create(baseIdRaw);
          if (baseIdResult.isErr()) {
            return err(baseIdResult.error);
          }
          references.push({
            foreignTableId: foreignTableIdResult.value,
            baseId: baseIdResult.value,
          });
        } else {
          references.push({
            foreignTableId: foreignTableIdResult.value,
          });
        }
        continue;
      }

      const resolvedResult = resolveTableFieldInputName(field, []);
      if (resolvedResult.isErr()) {
        return err(resolvedResult.error);
      }

      const specResult = parseTableFieldSpec(resolvedResult.value, { isPrimary: false });
      if (specResult.isErr()) {
        return err(specResult.error);
      }

      const fieldReferences = specResult.value.foreignTableReferences();
      if (fieldReferences.isErr()) {
        return err(fieldReferences.error);
      }
      references.push(...fieldReferences.value);
    }

    return ok(dedupeForeignTableReferences(references));
  }

  explicitFieldIds(): Result<ReadonlyArray<FieldId>, DomainError> {
    const fieldIds: FieldId[] = [];
    for (const field of this.fields) {
      if (!field.id) {
        continue;
      }
      const fieldIdResult = FieldId.create(field.id);
      if (fieldIdResult.isErr()) {
        return err(fieldIdResult.error);
      }
      fieldIds.push(fieldIdResult.value);
    }
    return ok(fieldIds);
  }
}
