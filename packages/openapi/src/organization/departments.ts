import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const GET_DEPARTMENT_LIST = '/organization/department';

export const getDepartmentListRoSchema = z.object({
  parentId: z.string().optional(),
  search: z.string().optional(),
  includeChildrenDepartment: z
    .string()
    .transform((value) => value === 'true')
    .optional(),
});

export type IGetDepartmentListRo = z.infer<typeof getDepartmentListRoSchema>;

export const getDepartmentVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
  path: z.array(z.string()).optional(),
  pathName: z.array(z.string()).optional(),
  hasChildren: z.boolean(),
});

export type IGetDepartmentVo = z.infer<typeof getDepartmentVoSchema>;

export const getDepartmentListVoSchema = z.array(getDepartmentVoSchema);

export type IGetDepartmentListVo = z.infer<typeof getDepartmentListVoSchema>;

export const getDepartmentListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_DEPARTMENT_LIST,
  request: {
    params: z.object({
      organizationId: z.string(),
    }),
    query: getDepartmentListRoSchema,
  },
  responses: {
    200: {
      description: 'Get department list successfully',
      content: { 'application/json': { schema: getDepartmentListVoSchema } },
    },
  },
  tags: ['organization'],
});

export const getDepartmentList = (ro: IGetDepartmentListRo) => {
  return axios.get<IGetDepartmentListVo>(GET_DEPARTMENT_LIST, {
    params: ro,
  });
};
