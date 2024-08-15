import type {
  BaseAction,
  TableAction,
  AutomationAction,
  TableRecordHistoryAction,
} from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_BASE_PERMISSION = '/base/{baseId}/permission';

export const GetBasePermissionVoSchema = z.record(
  z.custom<TableAction | BaseAction | AutomationAction | TableRecordHistoryAction>(),
  z.boolean()
);

export type IGetBasePermissionVo = z.infer<typeof GetBasePermissionVoSchema>;

export const GetBasePermissionRoute = registerRoute({
  method: 'get',
  path: GET_BASE_PERMISSION,
  description: 'Get a base permission',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about a base permission.',
      content: {
        'application/json': {
          schema: GetBasePermissionVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const getBasePermission = async (baseId: string) => {
  return axios.get<IGetBasePermissionVo>(
    urlBuilder(GET_BASE_PERMISSION, {
      baseId,
    })
  );
};
