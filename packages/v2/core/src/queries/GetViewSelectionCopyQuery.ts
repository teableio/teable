import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import type { ViewSelectionCopyRangeType } from '../domain/table/methods/createViewSelectionCopyPlan';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { recordFilterSchema, type RecordFilter } from './RecordFilterDto';
import { recordSearchInputSchema, type RecordSearchInput } from './RecordSearch';

const rangeSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
const sortSchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});
const groupSchema = sortSchema;

const getViewSelectionCopyInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  canCopyAsEditor: z.boolean().optional(),
  sharedView: z.boolean().optional(),
  ranges: z.array(rangeSchema).min(1),
  type: z.enum(['columns', 'rows']).optional(),
  projection: z.array(z.string().min(1)).optional(),
  filter: recordFilterSchema.optional(),
  orderBy: z.array(sortSchema).optional(),
  groupBy: z.array(groupSchema).optional(),
  search: recordSearchInputSchema,
  collapsedGroupIds: z.array(z.string()).optional(),
});

export type ViewSelectionCopySort = z.infer<typeof sortSchema>;
export type ViewSelectionCopyGroup = z.infer<typeof groupSchema>;

export class GetViewSelectionCopyQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly canCopyAsEditor: boolean,
    readonly sharedView: boolean,
    readonly ranges: ReadonlyArray<readonly [number, number]>,
    readonly type: ViewSelectionCopyRangeType,
    readonly projection: ReadonlyArray<FieldId> | undefined,
    readonly filter: RecordFilter | undefined,
    readonly orderBy: ReadonlyArray<ViewSelectionCopySort> | undefined,
    readonly groupBy: ReadonlyArray<ViewSelectionCopyGroup> | undefined,
    readonly search: RecordSearchInput | undefined,
    readonly collapsedGroupIds: ReadonlyArray<string> | undefined,
    readonly maxCopyCells: number,
    readonly maxGroupPoints: number
  ) {}

  static create(
    raw: unknown,
    options: { readonly maxCopyCells: number; readonly maxGroupPoints?: number }
  ): Result<GetViewSelectionCopyQuery, DomainError> {
    const parsed = getViewSelectionCopyInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid GetViewSelectionCopyQuery input',
          details: { issues: parsed.error.issues },
        })
      );
    }
    if (!Number.isInteger(options.maxCopyCells) || options.maxCopyCells <= 0) {
      return err(domainError.validation({ message: 'Invalid maxCopyCells' }));
    }

    return safeTry<GetViewSelectionCopyQuery, DomainError>(function* () {
      const tableId = yield* TableId.create(parsed.data.tableId);
      const viewId = yield* ViewId.create(parsed.data.viewId);
      const projection: FieldId[] = [];
      for (const fieldId of parsed.data.projection ?? []) {
        projection.push(yield* FieldId.create(fieldId));
      }
      return ok(
        new GetViewSelectionCopyQuery(
          tableId,
          viewId,
          parsed.data.canCopyAsEditor ?? false,
          parsed.data.sharedView ?? true,
          parsed.data.ranges,
          parsed.data.type,
          projection.length ? projection : undefined,
          parsed.data.filter,
          parsed.data.orderBy,
          parsed.data.groupBy,
          parsed.data.search,
          parsed.data.collapsedGroupIds,
          options.maxCopyCells,
          Math.max(1, Math.floor(options.maxGroupPoints ?? 5_000))
        )
      );
    });
  }
}
