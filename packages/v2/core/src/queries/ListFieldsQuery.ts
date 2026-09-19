import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';

export const listFieldsInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string().optional(),
  fieldIds: z.array(z.string()).optional(),
});

export type IListFieldsQueryInput = z.input<typeof listFieldsInputSchema>;

export class ListFieldsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId?: ViewId,
    readonly fieldIds?: ReadonlyArray<FieldId>
  ) {}

  static create(raw: unknown): Result<ListFieldsQuery, DomainError> {
    const parsed = listFieldsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid ListFieldsQuery input' }));
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) => {
      const fieldIdsResult = parseFieldIds(parsed.data.fieldIds);
      if (fieldIdsResult.isErr()) return err(fieldIdsResult.error);

      if (parsed.data.viewId == null) {
        return ok(new ListFieldsQuery(tableId, undefined, fieldIdsResult.value));
      }
      return ViewId.create(parsed.data.viewId).map(
        (viewId) => new ListFieldsQuery(tableId, viewId, fieldIdsResult.value)
      );
    });
  }
}

const parseFieldIds = (
  fieldIds: ReadonlyArray<string> | undefined
): Result<ReadonlyArray<FieldId> | undefined, DomainError> => {
  if (fieldIds == null) return ok(undefined);

  const parsed: FieldId[] = [];
  for (const fieldId of fieldIds) {
    const fieldIdResult = FieldId.create(fieldId);
    if (fieldIdResult.isErr()) return err(fieldIdResult.error);
    parsed.push(fieldIdResult.value);
  }
  return ok(parsed);
};
