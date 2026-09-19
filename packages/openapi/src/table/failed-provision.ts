import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const failedProvisionSchema = z.object({
  id: z.string(),
  name: z.string(),
  operationId: z.string(),
  operationType: z.string(),
  reason: z.string(),
});
export type IFailedTableProvision = z.infer<typeof failedProvisionSchema>;
const listPath = '/base/{baseId}/table/failed-provision/list';
const cleanupPath = '/base/{baseId}/table/{tableId}/failed-provision';
export const ListFailedProvisionsRoute = registerRoute({
  method: 'get',
  path: listPath,
  summary: 'List terminal failed table provisioning',
  tags: ['table'],
  request: { params: z.object({ baseId: z.string() }) },
  responses: {
    200: {
      description: 'Terminal failed tables visible to the caller',
      content: {
        'application/json': { schema: z.array(failedProvisionSchema) },
      },
    },
  },
});
export const CleanupFailedProvisionRoute = registerRoute({
  method: 'delete',
  path: cleanupPath,
  summary: 'Clean up an isolated empty failed import',
  tags: ['table'],
  request: { params: z.object({ baseId: z.string(), tableId: z.string() }) },
  responses: {
    200: { description: 'Cleanup completed, or already completed' },
    409: { description: 'Cleanup cannot be proven safe' },
  },
});
export const getFailedTableProvisions = (baseId: string) =>
  axios.get<IFailedTableProvision[]>(urlBuilder(listPath, { baseId }));
export const cleanupFailedTableProvision = (baseId: string, tableId: string) =>
  axios.delete<{ success: boolean }>(urlBuilder(cleanupPath, { baseId, tableId }));
