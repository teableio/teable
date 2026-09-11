import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import type { IUpdateOrderRo } from '../view/update-order';
import { updateOrderRoSchema } from '../view/update-order';
import { z } from '../zod';

export const BASE_PERSONAL_ORDER = '/base/{baseId}/personal-order';

export const updateBasePersonalOrderRoute: RouteConfig = registerRoute({
  method: 'put',
  path: BASE_PERSONAL_ORDER,
  description:
    "Move a base before/after another one in the caller's own arrangement of that space (see `GET /base/access/all?orderBy=personal`). The first move in a space freezes the order the caller currently sees; nobody else is affected.",
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateOrderRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Personal order updated',
    },
  },
  tags: ['base'],
});

export const updateBasePersonalOrder = async (params: { baseId: string } & IUpdateOrderRo) => {
  const { baseId, ...updateOrderRo } = params;
  return axios.put<void>(urlBuilder(BASE_PERSONAL_ORDER, { baseId }), updateOrderRo);
};

export const RESET_BASE_PERSONAL_ORDER = '/base/personal-order/{spaceId}';

export const resetBasePersonalOrderRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: RESET_BASE_PERSONAL_ORDER,
  description:
    "Forget the caller's own arrangement of a space's bases; the personal list goes back to last-visit recency.",
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Personal order reset',
    },
  },
  tags: ['base'],
});

export const resetBasePersonalOrder = async (spaceId: string) => {
  return axios.delete<void>(urlBuilder(RESET_BASE_PERSONAL_ORDER, { spaceId }));
};
