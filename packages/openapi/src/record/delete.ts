import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse, Axios } from 'axios';
import { axios as axiosInstance } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_RECORD_URL = '/table/{tableId}/record/{recordId}';

export const DeleteRecordRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_RECORD_URL,
  description: 'Delete a record',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['record'],
});

export async function deleteRecord(tableId: string, recordId: string): Promise<AxiosResponse<null>>;
export async function deleteRecord(
  axios: Axios,
  tableId: string,
  recordId: string
): Promise<AxiosResponse<null>>;
export async function deleteRecord(
  axios: Axios | string,
  tableId?: string,
  recordId?: string
): Promise<AxiosResponse<null>> {
  let theAxios: Axios;
  let theTableId: string;
  let theRecordId: string;

  if (typeof axios === 'string') {
    theAxios = axiosInstance;
    theTableId = axios;
    theRecordId = tableId as string;
  } else {
    theAxios = axios;
    theTableId = tableId as string;
    theRecordId = recordId!;
  }

  return theAxios.delete<null>(
    urlBuilder(DELETE_RECORD_URL, { tableId: theTableId, recordId: theRecordId })
  );
}
