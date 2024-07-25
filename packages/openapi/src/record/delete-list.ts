import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse, Axios } from 'axios';
import { axios as axiosInstance } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_RECORDS_URL = '/table/{tableId}/record';

export const deleteRecordsQuerySchema = z.object({
  recordIds: z.array(z.string()),
});

export type IDeleteRecordsQuery = z.infer<typeof deleteRecordsQuerySchema>;

export const DeleteRecordsRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_RECORDS_URL,
  description: 'Delete multiple records',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: deleteRecordsQuerySchema,
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['record'],
});

// Function overloads for deleteRecords
export async function deleteRecords(
  tableId: string,
  recordIds: string[]
): Promise<AxiosResponse<null>>;
export async function deleteRecords(
  axios: Axios,
  tableId: string,
  recordIds: string[]
): Promise<AxiosResponse<null>>;
export async function deleteRecords(
  axios: Axios | string,
  tableId?: string | string[],
  recordIds?: string[]
): Promise<AxiosResponse<null>> {
  let theAxios: Axios;
  let theTableId: string;
  let theRecordIds: string[];

  if (typeof axios === 'string') {
    theAxios = axiosInstance;
    theTableId = axios;
    theRecordIds = tableId as string[];
  } else {
    theAxios = axios;
    theTableId = tableId as string;
    theRecordIds = recordIds as string[];
  }

  theRecordIds = theRecordIds || [];

  return theAxios.delete<null>(urlBuilder(DELETE_RECORDS_URL, { tableId: theTableId }), {
    params: { recordIds: theRecordIds },
  });
}
