import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { TableCreateViewInput } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { viewRecordFilterSchema } from '../domain/table/views/ViewQueryDefaults';
import { ViewSourceFilter, viewSourceFilterSchema } from '../domain/table/views/ViewSourceFilter';
import { PublicCommand } from './PublicCommand';

const viewColumnMetaEntrySchema = z.looseObject({
  order: z.number().nullable().optional(),
  visible: z.boolean().optional(),
  hidden: z.boolean().optional(),
  width: z.number().optional(),
  required: z.boolean().optional(),
  statisticFunc: z.string().nullable().optional(),
});

const createViewConfigSchema = z.object({
  name: z.string().optional(),
  type: z.enum(['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin']),
  description: z.string().optional(),
  columnMeta: z.record(z.string(), viewColumnMetaEntrySchema).optional(),
  options: z.unknown().optional(),
  filter: viewRecordFilterSchema.optional().nullable(),
  sourceFilter: viewSourceFilterSchema.optional(),
  sort: z
    .array(z.object({ fieldId: z.string().min(1), order: z.enum(['asc', 'desc']) }))
    .optional(),
  group: z
    .array(z.object({ fieldId: z.string().min(1), order: z.enum(['asc', 'desc']) }))
    .optional(),
  manualSort: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  order: z.number().optional(),
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
    .optional(),
});

export const createViewInputSchema = z.object({
  tableId: z.string(),
  view: createViewConfigSchema,
});

export type ICreateViewCommandInput = z.input<typeof createViewInputSchema>;

export class CreateViewCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly view: TableCreateViewInput
  ) {
    super();
  }

  static create(raw: unknown): Result<CreateViewCommand, DomainError> {
    const parsed = createViewInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid CreateViewCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) => {
      if (parsed.data.view.sourceFilter === undefined) {
        return ok(new CreateViewCommand(tableId, parsed.data.view));
      }
      return ViewSourceFilter.create(parsed.data.view.sourceFilter).map(
        (sourceFilter) =>
          new CreateViewCommand(tableId, {
            ...parsed.data.view,
            filter: sourceFilter.toCanonical(),
          })
      );
    });
  }
}
