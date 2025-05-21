import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { getBaseItemSchema } from '../../base/get';
import { getListSchemaVo } from '../../types';
import { registerRoute } from '../../utils';
import { z } from '../../zod';
import { LastVisitResourceType } from './get';

export const GET_USER_LAST_VISIT_LIST_BASE = '/user/last-visit/list-base';

export const userLastVisitItemBaseVoSchema = z.object({
  resourceType: z.nativeEnum(LastVisitResourceType),
  resourceId: z.string(),
  resource: getBaseItemSchema.omit({ collaboratorType: true }),
  lastVisitTime: z.string().optional(),
});

export const userLastVisitListBaseVoSchema = getListSchemaVo(userLastVisitItemBaseVoSchema);

export type IUserLastVisitItemBaseVo = z.infer<typeof userLastVisitItemBaseVoSchema>;
export type IUserLastVisitListBaseVo = z.infer<typeof userLastVisitListBaseVoSchema>;

export const GetUserLastVisitListBaseRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_USER_LAST_VISIT_LIST_BASE,
  responses: {
    200: {
      description: 'Returns data about user last visit base.',
      content: {
        'application/json': {
          schema: userLastVisitListBaseVoSchema,
        },
      },
    },
  },
  tags: ['user'],
});

export const getUserLastVisitListBase = async () => {
  return axios.get<IUserLastVisitListBaseVo>(GET_USER_LAST_VISIT_LIST_BASE);
};
