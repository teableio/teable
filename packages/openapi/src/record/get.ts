import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRecord } from '@teable/core';
import { CellFormat, FieldKeyType, recordSchema } from '@teable/core';
import type { Axios, AxiosResponse } from 'axios';
import { axios as axiosInstance } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export type { IRecord } from '@teable/core';

export const fieldKeyTypeRoSchema = z
  .nativeEnum(FieldKeyType, {
    errorMap: () => ({ message: 'Error fieldKeyType, You should set it to "name" or "id"' }),
  })
  .default(FieldKeyType.Name) // is not work with optional()...
  .transform((v) => v ?? FieldKeyType.Name)
  .optional()
  .openapi({
    description:
      'Define the key type of record.fields[key], You can click "systemInfo" in the field edit box to get fieldId or enter the table design screen with all the field details',
  });

export const typecastSchema = z.boolean().optional().openapi({
  description:
    'Automatic data conversion from cellValues if the typecast parameter is passed in. Automatic conversion is disabled by default to ensure data integrity, but it may be helpful for integrating with 3rd party data sources.',
});

export const getRecordQuerySchema = z.object({
  projection: z.string().array().optional().openapi({
    description:
      'If you want to get only some fields, pass in this parameter, otherwise all visible fields will be obtained, The parameter value depends on the specified fieldKeyType to determine whether it is name or id',
  }),
  cellFormat: z
    .nativeEnum(CellFormat, {
      errorMap: () => ({ message: 'Error cellFormat, You should set it to "json" or "text"' }),
    })
    .default(CellFormat.Json)
    .optional()
    .openapi({
      description:
        'Define the return value formate, you can set it to text if you only need simple string value',
    }),
  fieldKeyType: fieldKeyTypeRoSchema,
});

export type IGetRecordQuery = z.infer<typeof getRecordQuerySchema>;

export const GET_RECORD_URL = '/table/{tableId}/record/{recordId}';

export const GetRecordRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_RECORD_URL,
  description: 'Get a record',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
    query: getRecordQuerySchema,
  },
  responses: {
    200: {
      description: 'Get a record',
      content: {
        'application/json': {
          schema: recordSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export async function getRecord(
  tableId: string,
  recordId: string,
  query?: IGetRecordQuery
): Promise<AxiosResponse<IRecord>>;
export async function getRecord(
  axios: Axios,
  tableId: string,
  recordId: string,
  query?: IGetRecordQuery
): Promise<AxiosResponse<IRecord>>;
export async function getRecord(
  axios: Axios | string,
  tableId: string,
  recordId?: string | IGetRecordQuery,
  query?: IGetRecordQuery
): Promise<AxiosResponse<IRecord>> {
  let theAxios: Axios;
  let theTableId: string;
  let theRecordId: string;
  let theQuery: IGetRecordQuery;

  if (typeof axios === 'string') {
    theAxios = axiosInstance;
    theTableId = axios;
    theRecordId = tableId;
    theQuery = (recordId as IGetRecordQuery) || {};
  } else {
    theAxios = axios;
    theTableId = tableId;
    theRecordId = recordId as string;
    theQuery = query || {};
  }

  return theAxios.get<IRecord>(
    urlBuilder(GET_RECORD_URL, { tableId: theTableId, recordId: theRecordId }),
    { params: theQuery }
  );
}
