import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { recordSchema } from '@teable/core';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { fieldKeyTypeRoSchema, typecastSchema } from './get';

export const upsertRecordOnConflictSchema = z
  .enum(['error', 'ignore', 'update'])
  .meta({
    description:
      'Behavior when a record already exists for the matchField value: "error" fails the request if any key exists; "ignore" skips existing rows without changing them; "update" updates only the provided fields on existing rows.',
    example: 'update',
  })
  .describe(
    'Behavior when a record already exists for the matchField value: "error" fails the request if any key exists; "ignore" skips existing rows without changing them; "update" updates only the provided fields on existing rows.'
  );

export const upsertRecordsRoSchema = z
  .object({
    fieldKeyType: fieldKeyTypeRoSchema,
    typecast: typecastSchema,
    matchField: z
      .string()
      .meta({
        description:
          'ID of the single field used to match existing records (e.g. "fldXXX"). That field must have unique=true; a non-unique field or a composite key is rejected.',
        example: 'fldXXX',
      })
      .describe(
        'ID of the single field used to match existing records (e.g. "fldXXX"). That field must have unique=true; a non-unique field or a composite key is rejected.'
      ),
    onConflict: upsertRecordOnConflictSchema,
    records: z
      .array(
        z.object({
          fields: recordSchema.shape.fields,
        })
      )
      .min(1)
      .meta({
        example: [
          {
            fields: {
              fldXXX: 'unique-key-value',
              fldYYY: 'value to create or update',
            },
          },
        ],
        description:
          'Array of records to upsert, in input order. Each record must contain the matchField value.',
      })
      .describe(
        'Array of records to upsert, in input order. Each record must contain the matchField value.'
      ),
  })
  .meta({
    description: 'Upsert records by a unique field',
  });

export type IUpsertRecordsRo = z.infer<typeof upsertRecordsRoSchema>;

export const upsertRecordStatusSchema = z.enum(['created', 'updated', 'unchanged', 'skipped']);

export type IUpsertRecordStatus = z.infer<typeof upsertRecordStatusSchema>;

export const upsertRecordResultVoSchema = z.object({
  index: z.number().meta({
    description: 'Zero-based position of the record in the request records array.',
  }),
  status: upsertRecordStatusSchema.meta({
    description:
      'Outcome for this row: created (new record), updated (existing row changed), unchanged (existing row already had the provided values, or the update wrote nothing), skipped (onConflict "ignore" and the row already exists).',
  }),
  recordId: z.string().optional().meta({
    description: 'The record id. Only present when the caller can read the row.',
  }),
  record: recordSchema.optional().meta({
    description: 'The record after the upsert. Only present when the caller can read the row.',
  }),
});

export type IUpsertRecordResultVo = z.infer<typeof upsertRecordResultVoSchema>;

export const upsertRecordsVoSchema = z.object({
  results: z.array(upsertRecordResultVoSchema).meta({
    description: 'Per-record results, in the same order as the request records.',
  }),
  summary: z.object({
    requested: z.number().meta({ description: 'Number of records in the request.' }),
    created: z.number().meta({ description: 'Number of records created.' }),
    updated: z.number().meta({ description: 'Number of existing records updated.' }),
    unchanged: z.number().meta({ description: 'Number of existing records left as-is.' }),
    skipped: z.number().meta({ description: 'Number of existing records skipped.' }),
  }),
});

export type IUpsertRecordsVo = z.infer<typeof upsertRecordsVoSchema>;

export const UPSERT_RECORD = '/table/{tableId}/record/upsert';

export const UpsertRecordRoute: RouteConfig = registerRoute({
  method: 'post',
  path: UPSERT_RECORD,
  summary: 'Upsert records',
  description:
    'Create or update records by matching a single field that has unique=true. Use this for sync-by-key writes instead of creating records and catching duplicate-key errors. With onConflict "update" only the provided fields are written; "ignore" leaves existing rows untouched; "error" fails if any key already exists.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: upsertRecordsRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description:
        'Per-record upsert results in request order, plus summary counts. recordId and record are only present for rows the caller can read.',
      content: {
        'application/json': {
          schema: upsertRecordsVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export async function upsertRecords(
  tableId: string,
  recordsRo: IUpsertRecordsRo
): Promise<AxiosResponse<IUpsertRecordsVo>> {
  return axios.post<IUpsertRecordsVo>(urlBuilder(UPSERT_RECORD, { tableId }), recordsRo);
}
