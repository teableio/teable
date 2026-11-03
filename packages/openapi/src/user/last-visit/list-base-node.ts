import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { getListSchemaVo } from '../../types';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import { LastVisitResourceType } from './get';

export const GET_USER_LAST_VISIT_LIST_BASE_NODE = '/user/last-visit/list-base-node';

export const getUserLastVisitListBaseNodeRoSchema = z.object({
  parentResourceId: z.string(),
});

export type IGetUserLastVisitListBaseNodeRo = z.infer<typeof getUserLastVisitListBaseNodeRoSchema>;

export const userLastVisitItemBaseNodeVoSchema = z.object({
  resourceType: z.enum(LastVisitResourceType),
  resourceId: z.string(),
  lastVisitTime: z.string(),
});

export const userLastVisitListBaseNodeVoSchema = getListSchemaVo(userLastVisitItemBaseNodeVoSchema);

export type IUserLastVisitItemBaseNodeVo = z.infer<typeof userLastVisitItemBaseNodeVoSchema>;
export type IUserLastVisitListBaseNodeVo = z.infer<typeof userLastVisitListBaseNodeVoSchema>;

export const GetUserLastVisitListBaseNodeRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_USER_LAST_VISIT_LIST_BASE_NODE,
  title: 'List user recently visited project nodes',
  description:
    "The caller's visited nodes in a project, newest first; empty for a project the caller cannot read",
  request: {
    query: getUserLastVisitListBaseNodeRoSchema,
  },
  responses: {
    200: {
      description: 'Returns the recently visited project nodes.',
      content: {
        'application/json': {
          schema: userLastVisitListBaseNodeVoSchema,
        },
      },
    },
  },
  tags: ['user'],
});

export const getUserLastVisitListBaseNode = async (params: IGetUserLastVisitListBaseNodeRo) => {
  return axios.get<IUserLastVisitListBaseNodeVo>(
    urlBuilder(GET_USER_LAST_VISIT_LIST_BASE_NODE, {}),
    { params }
  );
};
