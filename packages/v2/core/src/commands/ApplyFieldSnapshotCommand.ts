import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { ViewQueryDefaultsDTO } from '../domain/table/views/ViewQueryDefaults';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { recordFilterSchema } from '../queries/RecordFilterDto';
import { TableId } from '../domain/table/TableId';
import { tableFieldInputSchema } from '../schemas/field';
import { parseTableFieldSpec, resolveTableFieldInputName } from './TableFieldSpecs';
import { TableUpdateCommand } from './TableUpdateCommand';

const viewQueryDefaultsSnapshotSchema: z.ZodType<ViewQueryDefaultsDTO> = z
  .object({
    filter: recordFilterSchema.optional().nullable(),
    sort: z
      .array(
        z.object({
          fieldId: z.string().min(1),
          order: z.enum(['asc', 'desc']),
        })
      )
      .optional(),
    group: z
      .array(
        z.object({
          fieldId: z.string().min(1),
          order: z.enum(['asc', 'desc']),
        })
      )
      .optional(),
    manualSort: z.boolean().optional(),
  })
  .strict();

export const fieldSnapshotSchema = z.object({
  field: tableFieldInputSchema.and(z.object({ id: z.string() })),
  hasError: z.boolean().optional(),
  views: z.array(
    z.object({
      viewId: z.string(),
      columnMeta: z.record(z.string(), z.unknown()).nullable().optional(),
      query: viewQueryDefaultsSnapshotSchema.optional(),
      orderedFieldIds: z.array(z.string()).optional(),
    })
  ),
  records: z
    .array(
      z.object({
        recordId: z.string(),
        value: z.unknown(),
      })
    )
    .optional(),
});

export const applyFieldSnapshotInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  snapshot: fieldSnapshotSchema,
});

export type IApplyFieldSnapshotCommandInput = z.input<typeof applyFieldSnapshotInputSchema>;

export const resolveFieldSnapshotForeignTableReferences = (
  field: z.output<typeof fieldSnapshotSchema>['field']
): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> => {
  if (field.type === 'link') {
    const baseIdRaw = field.options.baseId;
    return TableId.create(field.options.foreignTableId).andThen((foreignTableId) =>
      baseIdRaw
        ? BaseId.create(baseIdRaw).map((baseId) => [{ foreignTableId, baseId }])
        : ok([{ foreignTableId }])
    );
  }

  return resolveTableFieldInputName(field, []).andThen((resolved) =>
    parseTableFieldSpec(resolved, { isPrimary: field.isPrimary === true }).andThen((spec) =>
      spec.foreignTableReferences()
    )
  );
};

export class ApplyFieldSnapshotCommand extends TableUpdateCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly snapshot: z.output<typeof fieldSnapshotSchema>
  ) {
    super(baseId, tableId);
  }

  static create(raw: unknown): Result<ApplyFieldSnapshotCommand, DomainError> {
    const parsed = applyFieldSnapshotInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ApplyFieldSnapshotCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map(
        (tableId) => new ApplyFieldSnapshotCommand(baseId, tableId, parsed.data.snapshot)
      )
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return resolveFieldSnapshotForeignTableReferences(this.snapshot.field);
  }
}
