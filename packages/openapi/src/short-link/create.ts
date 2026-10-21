import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const CREATE_SHORT_LINK = '/short-link';

export enum ShortLinkType {
  ViewShare = 'view-share',
  BaseShare = 'base-share',
  Template = 'template',
  Artifact = 'artifact',
}

export const createShortLinkRoSchema = z.object({
  type: z.nativeEnum(ShortLinkType).describe('The type of resource the short link points to'),
  resourceId: z
    .string()
    .min(1)
    .max(50)
    .describe('The resource identifier, e.g. a shareId (shrxxx) or templateId (tplxxx)'),
});

export type ICreateShortLinkRo = z.infer<typeof createShortLinkRoSchema>;

export const shortLinkVoSchema = z.object({
  code: z.string().describe('The short link code, accessible at /s/{code}'),
  path: z.string().describe('The in-app path the short link currently redirects to'),
});

export type IShortLinkVo = z.infer<typeof shortLinkVoSchema>;

export const CreateShortLinkRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_SHORT_LINK,
  description: 'Create (or reuse) the short link of a resource',
  summary: 'Create a short link',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createShortLinkRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully created short link.',
      content: {
        'application/json': {
          schema: shortLinkVoSchema,
        },
      },
    },
  },
  tags: ['short-link'],
});

export const createShortLink = async (createShortLinkRo: ICreateShortLinkRo) => {
  return axios.post<IShortLinkVo>(CREATE_SHORT_LINK, createShortLinkRo);
};
