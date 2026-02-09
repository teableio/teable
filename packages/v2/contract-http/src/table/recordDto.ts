import type { TableRecordReadModel, DomainError } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

export const tableRecordDtoSchema = z.object({
  id: z.string(),
  fields: z.record(z.string(), z.unknown()),
});

export type ITableRecordDto = z.infer<typeof tableRecordDtoSchema>;

export const mapTableRecordToDto = (
  record: TableRecordReadModel
): Result<ITableRecordDto, DomainError> => {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record.fields)) {
    if (value !== undefined) {
      fields[key] = value;
    }
  }
  return ok({ id: record.id, fields });
};
