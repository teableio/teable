import type { TableRecordReadModel } from '@teable/v2-core';
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
): Result<ITableRecordDto, string> => {
  return ok({ id: record.id, fields: record.fields });
};
