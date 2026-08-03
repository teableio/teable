import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { createDashboardRoSchema } from '../dashboard/create';
import { tableRoWithDefaultSchema } from '../table/create';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { createBaseNodeFolderRoSchema } from './folder/create';
import { baseNodeVoSchema, BaseNodeResourceType, type IBaseNodeVo } from './types';

export const CREATE_BASE_NODE = '/base/{baseId}/node';

const createBaseNodeSchema = z.object({
  resourceType: z.enum(BaseNodeResourceType),
  parentId: z.string().nullable().optional(),
  name: z.string().trim().min(1),
});

export type ICreateBaseNode = z.infer<typeof createBaseNodeSchema>;

const createBaseFolderNodeRoSchema = z.object({
  ...createBaseNodeSchema.shape,
  resourceType: z.literal(BaseNodeResourceType.Folder),
  ...createBaseNodeFolderRoSchema.shape,
});

export type ICreateFolderNodeRo = z.infer<typeof createBaseFolderNodeRoSchema>;

const createBaseTableNodeRoSchema = z.object({
  ...createBaseNodeSchema.shape,
  resourceType: z.literal(BaseNodeResourceType.Table),
  ...tableRoWithDefaultSchema.shape,
});

export type ICreateTableNodeRo = z.infer<typeof createBaseTableNodeRoSchema>;

const createBaseDashboardNodeRoSchema = z.object({
  ...createBaseNodeSchema.shape,
  resourceType: z.literal(BaseNodeResourceType.Dashboard),
  ...createDashboardRoSchema.shape,
});

export type ICreateDashboardNodeRo = z.infer<typeof createBaseDashboardNodeRoSchema>;

const createBaseWorkflowNodeRoSchema = z.object({
  ...createBaseNodeSchema.shape,
  resourceType: z.literal(BaseNodeResourceType.Workflow),
});

export type ICreateWorkflowNodeRo = z.infer<typeof createBaseWorkflowNodeRoSchema>;

const createBaseAppNodeRoSchema = z.object({
  ...createBaseNodeSchema.shape,
  resourceType: z.literal(BaseNodeResourceType.App),
});

export type ICreateAppNodeRo = z.infer<typeof createBaseAppNodeRoSchema>;

export const createBaseNodeRoSchema = z.discriminatedUnion('resourceType', [
  createBaseFolderNodeRoSchema,
  createBaseTableNodeRoSchema,
  createBaseDashboardNodeRoSchema,
  createBaseWorkflowNodeRoSchema,
  createBaseAppNodeRoSchema,
]);

export type ICreateBaseNodeRo = z.infer<typeof createBaseNodeRoSchema>;

export const CreateBaseNodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_BASE_NODE,
  description: 'Create a hierarchical node for a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createBaseNodeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Created node',
      content: {
        'application/json': {
          schema: baseNodeVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const createBaseNode = async (baseId: string, ro: ICreateBaseNodeRo) => {
  return axios.post<IBaseNodeVo>(urlBuilder(CREATE_BASE_NODE, { baseId }), ro);
};
