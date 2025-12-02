import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const CREATE_BASE_NODE_FOLDER = '/base/{baseId}/node/folder';

export const createBaseNodeFolderRoSchema = z.object({
  name: z.string().trim().min(1),
});

export type ICreateBaseNodeFolderRo = z.infer<typeof createBaseNodeFolderRoSchema>;

export const createBaseNodeFolderVoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type ICreateBaseNodeFolderVo = z.infer<typeof createBaseNodeFolderVoSchema>;

export const CreateBaseNodeFolderRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_BASE_NODE_FOLDER,
  description: 'Create a folder node in base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createBaseNodeFolderRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Created folder node',
      content: {
        'application/json': {
          schema: createBaseNodeFolderVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const createBaseNodeFolder = async (baseId: string, ro: ICreateBaseNodeFolderRo) => {
  return axios.post<ICreateBaseNodeFolderVo>(urlBuilder(CREATE_BASE_NODE_FOLDER, { baseId }), ro);
};
