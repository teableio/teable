import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import type { ViewSnapshotValue } from '../domain/table/views/ViewSnapshot';
import { PublicCommand } from './PublicCommand';

export const viewSnapshotSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin']),
    order: z.number().finite().optional(),
    properties: z
      .object({
        description: z.string().optional(),
        isLocked: z.boolean().optional(),
        enableShare: z.boolean().optional(),
        shareId: z.string().optional(),
        shareMeta: z
          .object({
            allowCopy: z.boolean().optional(),
            includeHiddenField: z.boolean().optional(),
            password: z.string().min(3).optional(),
            includeRecords: z.boolean().optional(),
            submit: z.object({ requireLogin: z.boolean().optional() }).optional(),
            allowEdit: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    columnMeta: z.record(z.string(), z.record(z.string(), z.unknown())),
    query: z
      .object({
        filter: z.unknown().optional(),
        sort: z.array(z.object({ fieldId: z.string(), order: z.enum(['asc', 'desc']) })).optional(),
        group: z
          .array(z.object({ fieldId: z.string(), order: z.enum(['asc', 'desc']) }))
          .optional(),
        manualSort: z.boolean().optional(),
      })
      .strict(),
    sourceFilter: z.unknown().optional(),
    options: z.unknown().optional(),
    auditMetadata: z
      .object({
        createdBy: z.string().min(1),
        createdTime: z.string().min(1),
        lastModifiedBy: z.string().min(1).optional(),
        lastModifiedTime: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const applyViewSnapshotInputSchema = z
  .object({
    tableId: z.string(),
    snapshot: viewSnapshotSchema,
  })
  .strict();

export class ApplyViewSnapshotCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly snapshot: ViewSnapshotValue
  ) {
    super();
  }

  static create(raw: unknown): Result<ApplyViewSnapshotCommand, DomainError> {
    const parsed = applyViewSnapshotInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ApplyViewSnapshotCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).map(
      (tableId) => new ApplyViewSnapshotCommand(tableId, parsed.data.snapshot as ViewSnapshotValue)
    );
  }
}
