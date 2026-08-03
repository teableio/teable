import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_INTEGRATION = '/space/{spaceId}/integration/{integrationId}';

export const DeleteIntegrationRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_INTEGRATION,
  description: 'Delete a integration by integrationId',
  request: {
    params: z.object({
      spaceId: z.string(),
      integrationId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['space', 'integration'],
});

export const deleteIntegration = async (spaceId: string, integrationId: string) => {
  return await axios.delete<null>(
    urlBuilder(DELETE_INTEGRATION, {
      spaceId,
      integrationId,
    })
  );
};
