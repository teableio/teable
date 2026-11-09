import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { TableId } from '../domain/table/TableId';
import type { ViewQueryDefaultsDTO } from '../domain/table/views/ViewQueryDefaults';
import { viewSortItemSchema } from '../domain/table/views/ViewSort';
import { recordFilterSchema } from '../queries/RecordFilterDto';
import { tableFieldInputSchema } from '../schemas/field';
import { parseTableFieldSpec, resolveTableFieldInputName } from './TableFieldSpecs';
import { TableUpdateCommand } from './TableUpdateCommand';

export const viewQueryDefaultsSnapshotSchema: z.ZodType<ViewQueryDefaultsDTO> = z
  .object({
    filter: recordFilterSchema.optional().nullable(),
    sort: z.array(viewSortItemSchema).optional(),
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
        value: z.unknown().optional(),
      })
    )
    .optional(),
});

const relatedViewQuerySnapshotSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  query: viewQueryDefaultsSnapshotSchema,
  sourceFilter: z.unknown().optional(),
});

const relatedViewQueryReplaySchema = z.object({
  snapshot: relatedViewQuerySnapshotSchema,
  expected: relatedViewQuerySnapshotSchema,
});

export const applyFieldSnapshotInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string(),
  snapshot: fieldSnapshotSchema,
  expectedSnapshot: fieldSnapshotSchema.optional(),
  relatedViewQueries: z.array(relatedViewQueryReplaySchema).optional(),
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
    parseTableFieldSpec(resolved, {
      isPrimary: field.isPrimary === true,
      aiConfigMode: 'trustedRehydrate',
    }).andThen((spec) => spec.foreignTableReferences())
  );
};

export class ApplyFieldSnapshotCommand extends TableUpdateCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly snapshot: z.output<typeof fieldSnapshotSchema>,
    readonly expectedSnapshot: z.output<typeof fieldSnapshotSchema> | undefined,
    readonly relatedViewQueries: z.output<typeof relatedViewQueryReplaySchema>[] | undefined
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
        (tableId) =>
          new ApplyFieldSnapshotCommand(
            baseId,
            tableId,
            parsed.data.snapshot,
            parsed.data.expectedSnapshot,
            parsed.data.relatedViewQueries
          )
      )
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return resolveFieldSnapshotForeignTableReferences(this.snapshot.field);
  }
}
