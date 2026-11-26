import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_PUBLIC_FILE_STATUS = '/table/{tableId}/field/{fieldId}/public-file/status';

/** Whether the links of a public field open their files right now. */
export enum PublicFileAvailability {
  Live = 'live',
  /** The space ran out of credits: links return 404 until it is topped up. */
  Paused = 'paused',
  /** The space's plan no longer includes public files: links stop or have stopped working. */
  PlanLapsed = 'plan_lapsed',
}

export const publicFileFailureVoSchema = z.object({
  recordId: z.string(),
  attachmentId: z.string(),
  name: z.string(),
  error: z.string(),
});

export type IPublicFileFailureVo = z.infer<typeof publicFileFailureVoSchema>;

export const publicFileStatusVoSchema = z.object({
  isPublic: z.boolean().meta({ description: 'Whether the field publishes its files now' }),
  total: z.number().meta({ description: 'Files in the field' }),
  published: z.number().meta({ description: 'Files whose public link works' }),
  pending: z.number().meta({ description: 'Files still being copied' }),
  failed: z.number().meta({ description: 'Files that failed to copy' }),
  failures: z
    .array(publicFileFailureVoSchema)
    .meta({ description: 'The first few failed files, with the reason' }),
  availability: z
    .enum(PublicFileAvailability)
    .optional()
    .meta({ description: 'Whether the links open their files right now, while it is public' }),
});

export type IPublicFileStatusVo = z.infer<typeof publicFileStatusVoSchema>;

export const GetPublicFileStatusRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PUBLIC_FILE_STATUS,
  summary: 'Get public file status',
  description:
    'How many files of an attachment field are public, still being copied, or failed to copy.',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Public file status of the field',
      content: {
        'application/json': {
          schema: publicFileStatusVoSchema,
        },
      },
    },
  },
  tags: ['public-file'],
});

export const getPublicFileStatus = async (tableId: string, fieldId: string) => {
  return axios.get<IPublicFileStatusVo>(urlBuilder(GET_PUBLIC_FILE_STATUS, { tableId, fieldId }));
};
