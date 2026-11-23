import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';
import { fieldKeyTypeSchema, type FieldKeyType } from '../domain/table/fields/FieldKeyType';

export const getRecordByIdInputSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
  fieldKeyType: fieldKeyTypeSchema,
  projection: z.array(z.string().min(1)).optional(),
  cellFormat: z.enum(['json', 'text']).optional().default('json'),
  includeOrders: z.boolean().optional(),
  viewId: z.string().optional(),
});

export type IGetRecordByIdQueryInput = z.input<typeof getRecordByIdInputSchema>;

export class GetRecordByIdQuery {
  private constructor(
    readonly tableId: TableId,
    readonly recordId: RecordId,
    readonly fieldKeyType: FieldKeyType,
    readonly projection?: ReadonlyArray<string>,
    readonly cellFormat: 'json' | 'text' = 'json',
    readonly includeOrders?: boolean,
    readonly viewId?: string
  ) {}

  static create(raw: unknown): Result<GetRecordByIdQuery, DomainError> {
    const parsed = getRecordByIdInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid GetRecordByIdQuery input' }));

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      RecordId.create(parsed.data.recordId).map(
        (recordId) => new GetRecordByIdQuery(tableId, recordId, parsed.data.fieldKeyType, parsed.data.projection, parsed.data.cellFormat, parsed.data.includeOrders, parsed.data.viewId)
      )
    );
  }
}
