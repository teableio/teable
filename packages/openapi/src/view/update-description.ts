import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_DESCRIPTION = '/table/{tableId}/view/{viewId}/description';

export const viewDescriptionRoSchema = z.object({
  description: z.string(),
});

export type IViewDescriptionRo = z.infer<typeof viewDescriptionRoSchema>;

export const updateViewDescriptionRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_DESCRIPTION,
  description: 'Update view description',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: viewDescriptionRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['view'],
});

export const updateViewDescription = async (
  tableId: string,
  viewId: string,
  data: IViewDescriptionRo
) => {
  return axios.put<void>(
    urlBuilder(VIEW_DESCRIPTION, {
      tableId,
      viewId,
    }),
    data
  );
};
