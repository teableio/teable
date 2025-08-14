import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { z } from '../../zod';
import { LastVisitResourceType } from './get';

export const UPDATE_USER_LAST_VISIT = '/user/last-visit';

export const updateUserLastVisitRoSchema = z.object({
  resourceType: z.nativeEnum(LastVisitResourceType),
  resourceId: z.string(),
  parentResourceId: z.string(),
  childResourceId: z.string().optional(),
});

export type IUpdateUserLastVisitRo = z.infer<typeof updateUserLastVisitRoSchema>;

export const UpdateUserLastVisitRoute: RouteConfig = registerRoute({
  method: 'post',
  path: UPDATE_USER_LAST_VISIT,
  description: 'Update or create user last visit record',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateUserLastVisitRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully updated user last visit record.',
    },
  },
  tags: ['user'],
});

export const updateUserLastVisit = async (updateUserLastVisitRo: IUpdateUserLastVisitRo) => {
  return axios.post<IUpdateUserLastVisitRo>(UPDATE_USER_LAST_VISIT, updateUserLastVisitRo);
};
