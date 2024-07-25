import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRecord } from '@teable/core';
import { recordSchema } from '@teable/core';
import type { AxiosResponse, Axios } from 'axios';
import { axios as axiosInstance } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { recordInsertOrderRoSchema } from './create';
import { fieldKeyTypeRoSchema, typecastSchema } from './get';

export const updateRecordRoSchema = z
  .object({
    fieldKeyType: fieldKeyTypeRoSchema,
    typecast: typecastSchema,
    record: z.object({
      fields: recordSchema.shape.fields,
    }),
    order: recordInsertOrderRoSchema.optional(),
  })
  .openapi({
    description: 'Update record by id',
  });

export type IUpdateRecordRo = z.infer<typeof updateRecordRoSchema>;

export const updateRecordsRoSchema = z
  .object({
    fieldKeyType: fieldKeyTypeRoSchema,
    typecast: typecastSchema,
    records: z.array(
      z.object({
        id: z.string(),
        fields: recordSchema.shape.fields,
      })
    ),
    order: recordInsertOrderRoSchema.optional(),
  })
  .openapi({
    description: 'Multiple Update records',
  });

export type IUpdateRecordsRo = z.infer<typeof updateRecordsRoSchema>;

export const UPDATE_RECORD = '/table/{tableId}/record/{recordId}';

export const UpdateRecordRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_RECORD,
  description: 'Update a record',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateRecordRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns record data after update.',
      content: {
        'application/json': {
          schema: recordSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export async function updateRecord(
  tableId: string,
  recordId: string,
  recordRo: IUpdateRecordRo
): Promise<AxiosResponse<IRecord>>;
export async function updateRecord(
  axios: Axios,
  tableId: string,
  recordId: string,
  recordRo: IUpdateRecordRo
): Promise<AxiosResponse<IRecord>>;
export async function updateRecord(
  axios: Axios | string,
  tableId?: string,
  recordId?: string | IUpdateRecordRo,
  recordRo?: IUpdateRecordRo
): Promise<AxiosResponse<IRecord>> {
  let theAxios: Axios;
  let theTableId: string;
  let theRecordId: string;
  let theRecordRo: IUpdateRecordRo;

  if (typeof axios === 'string') {
    theAxios = axiosInstance;
    theTableId = axios;
    theRecordId = tableId as string;
    theRecordRo = recordId as IUpdateRecordRo;
  } else {
    theAxios = axios;
    theTableId = tableId as string;
    theRecordId = recordId as string;
    theRecordRo = recordRo!;
  }

  return theAxios.patch<IRecord>(
    urlBuilder(UPDATE_RECORD, { tableId: theTableId, recordId: theRecordId }),
    theRecordRo
  );
}
