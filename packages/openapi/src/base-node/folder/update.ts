import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import type { IBaseNodeVo } from '../types';
import { baseNodeVoSchema } from '../types';

export const UPDATE_BASE_NODE_FOLDER = '/base/{baseId}/node/folder/{folderId}';

export const updateBaseNodeFolderRoSchema = z.object({
  name: z.string().trim().min(1),
});

export type IUpdateBaseNodeFolderRo = z.infer<typeof updateBaseNodeFolderRoSchema>;

export const UpdateBaseNodeFolderRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_BASE_NODE_FOLDER,
  description: 'Rename a node folder',
  request: {
    params: z.object({
      baseId: z.string(),
      folderId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateBaseNodeFolderRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated node folder',
      content: {
        'application/json': {
          schema: baseNodeVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const updateBaseNodeFolder = async (
  baseId: string,
  folderId: string,
  ro: IUpdateBaseNodeFolderRo
) => {
  return axios.patch<IBaseNodeVo>(urlBuilder(UPDATE_BASE_NODE_FOLDER, { baseId, folderId }), ro);
};
