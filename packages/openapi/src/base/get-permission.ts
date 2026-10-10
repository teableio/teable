import type {
  BaseAction,
  TableAction,
  AutomationAction,
  RoutineAction,
  TableRecordHistoryAction,
  AppAction,
} from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_BASE_PERMISSION = '/base/{baseId}/permission';

export const GetBasePermissionVoSchema = z.record(
  z.custom<
    | TableAction
    | BaseAction
    | AutomationAction
    | RoutineAction
    | AppAction
    | TableRecordHistoryAction
  >(),
  z.boolean()
);

export type IGetBasePermissionVo = z.infer<typeof GetBasePermissionVoSchema>;

export const GetBasePermissionRoute = registerRoute({
  method: 'get',
  path: GET_BASE_PERMISSION,
  title: 'Get project permissions',
  description: "Retrieve the current user's permissions for a project.",
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about a project permission.',
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
