import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { ITemplateVo } from './get';

export const GET_PUBLISHED_TEMPLATE_LIST = '/template/published';

export enum TemplateListSort {
  Order = 'order',
  Ranking = 'ranking',
  Newest = 'newest',
}

export const templateQueryRoSchema = z.object({
  featured: z.stringbool().optional().meta({
    default: true,
    example: true,
    description: 'Whether to get featured templates',
  }),
  categoryId: z.string().startsWith(IdPrefix.TemplateCategory).optional().nullable().meta({
    example: 'tc_123',
    description: 'The template category id',
  }),
  skip: z.coerce.number().optional().meta({
    default: 0,
    example: 0,
    description: 'The templates count you want to skip',
  }),
  take: z.coerce.number().optional().meta({
    default: 100,
    example: 100,
    description: 'The templates count you want to take',
  }),
  search: z.string().optional().meta({
    example: 'template',
    description: 'Words to narrow the list by; each must appear in the name or the description',
  }),
  sort: z.enum(TemplateListSort).optional().meta({
    example: 'ranking',
    description:
      "ranking: by this month's usage score, highest first; newest: last published first. Omitted: the admin's order.",
  }),
  requires: z.string().optional().meta({
    example: 'slack',
    description: 'Only templates that connect this provider; `none`: those that connect nothing.',
  }),
  createdBy: z.string().optional().meta({
    example: 'usr_123',
    description: 'Only templates by this author.',
  }),
});

export type ITemplateQueryRoSchema = z.infer<typeof templateQueryRoSchema>;

export const GetPublishedTemplateListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PUBLISHED_TEMPLATE_LIST,
  description: 'get published template list',
  request: {
    query: templateQueryRoSchema,
  },
  responses: {
    201: {
      description: 'Successfully get published template list.',
    },
  },
  tags: ['template'],
});

export const getPublishedTemplateList = async (query?: ITemplateQueryRoSchema) => {
  return axios.get<ITemplateVo[]>(urlBuilder(GET_PUBLISHED_TEMPLATE_LIST), {
    params: query,
  });
};
