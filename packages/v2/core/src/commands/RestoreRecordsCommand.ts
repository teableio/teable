import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';

export const restoreRecordsInputSchema = z.object({
  tableId: z.string(),
  records: z
    .array(
      z.object({
        recordId: z.string(),
        fields: z.record(z.string(), z.unknown()).default({}),
        orders: z.record(z.string(), z.number()).optional(),
        autoNumber: z.number().optional(),
        createdTime: z.string().optional(),
        createdBy: z.string().optional(),
        lastModifiedTime: z.string().optional(),
        lastModifiedBy: z.string().optional(),
      })
    )
    .min(1, 'At least one record is required'),
});

export type IRestoreRecordsCommandInput = z.input<typeof restoreRecordsInputSchema>;

export type RestoreRecordInput = z.infer<typeof restoreRecordsInputSchema>['records'][number];

export class RestoreRecordsCommand {
  private constructor(
    readonly tableId: TableId,
    readonly records: ReadonlyArray<RestoreRecordInput>
  ) {}

  static create(raw: unknown): Result<RestoreRecordsCommand, DomainError> {
    const parsed = restoreRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid RestoreRecordsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).map(
      (tableId) => new RestoreRecordsCommand(tableId, parsed.data.records)
    );
  }
}
