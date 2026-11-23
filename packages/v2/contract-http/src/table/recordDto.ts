import type { TableRecordReadModel, DomainError } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

export const tableRecordDtoSchema = z.object({
  id: z.string(),
  fields: z.record(z.string(), z.unknown()),
  name: z.string().optional(),
  version: z.number().optional(),
  autoNumber: z.number().optional(),
  createdTime: z.string().optional(),
  createdBy: z.string().optional(),
  lastModifiedTime: z.string().optional(),
  lastModifiedBy: z.string().optional(),
  orders: z.record(z.string(), z.number()).optional(),
  permissions: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
  undeletable: z.boolean().optional(),
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
  return ok({
    id: record.id,
    fields,
    name: record.name,
    version: record.version,
    autoNumber: record.autoNumber,
    createdTime: record.createdTime,
    createdBy: record.createdBy,
    lastModifiedTime: record.lastModifiedTime,
    lastModifiedBy: record.lastModifiedBy,
    orders: record.orders,
    permissions: record.permissions,
    undeletable: record.undeletable,
  });
};
