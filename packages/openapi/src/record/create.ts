import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { recordSchema } from '@teable/core';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { fieldKeyTypeRoSchema, typecastSchema } from './get';
import { recordsVoSchema } from './get-list';

export const recordInsertOrderRoSchema = z
  .object({
    viewId: z
      .string()
      .openapi({
        description:
          'You can only specify order in one view when create record (will create a order index automatically)',
      })
      .describe(
        'You can only specify order in one view when create record (will create a order index automatically)'
      ),
    anchorId: z
      .string()
      .openapi({
        description: 'The record id to anchor to',
      })
      .describe('The record id to anchor to'),
    position: z.enum(['before', 'after']),
  })
  .openapi({
    description: 'Where this record to insert to (Optional)',
  });

export type IRecordInsertOrderRo = z.infer<typeof recordInsertOrderRoSchema>;

export const createRecordsRoSchema = z
  .object({
    fieldKeyType: fieldKeyTypeRoSchema,
    typecast: typecastSchema,
    order: recordInsertOrderRoSchema.optional(),
    records: z
      .object({
        fields: recordSchema.shape.fields,
      })
      .array()
      .openapi({
        example: [
          {
            fields: {
              'single line text': 'text value',
            },
          },
        ],
        description: 'Array of record objects ',
      }),
  })
  .openapi({
    description: 'Multiple Create records',
  });

export type ICreateRecordsRo = z.infer<typeof createRecordsRoSchema>;

export const createRecordsVoSchema = recordsVoSchema.pick({ records: true });

export type ICreateRecordsVo = z.infer<typeof createRecordsVoSchema>;

export const CREATE_RECORD = '/table/{tableId}/record';

export const CreateRecordRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_RECORD,
  summary: 'Create records',
  description:
    'Create one or multiple records with support for field value typecast and custom record ordering.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createRecordsRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns data about the records.',
      content: {
        'application/json': {
          schema: createRecordsVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export async function createRecords(
  tableId: string,
  recordsRo: ICreateRecordsRo
): Promise<AxiosResponse<ICreateRecordsVo>> {
  return axios.post<ICreateRecordsVo>(urlBuilder(CREATE_RECORD, { tableId }), recordsRo);
}
