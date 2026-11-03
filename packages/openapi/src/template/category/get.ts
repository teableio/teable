import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { z } from 'zod';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';

export const GET_TEMPLATE_CATEGORY_LIST = '/template/category/list';

/**
 * Two ways to file a template: by the kind of business it is for (industries, two levels)
 * and by the team that would use it (teams, one level). A template may carry both.
 */
export enum TemplateCategoryKind {
  Industry = 'industry',
  Team = 'team',
}

export const templateCategoryKindSchema = z.enum(TemplateCategoryKind);

export const templateCategoryListVoSchema = z.object({
  id: z.string().startsWith(IdPrefix.TemplateCategory),
  name: z.string(),
  order: z.number(),
  parentId: z.string().nullable(),
  kind: templateCategoryKindSchema,
  /** Names the category in public URLs (/templates/industry/<key>); null until an admin sets one. */
  key: z.string().nullable(),
});

export type ITemplateCategoryListVo = z.infer<typeof templateCategoryListVoSchema>;

/** The industry tree (roots, with their sub-industries by id) and the flat team list, from one list. */
export const groupTemplateCategories = (list: ITemplateCategoryListVo[]) => ({
  industries: list.filter((c) => c.kind === TemplateCategoryKind.Industry && !c.parentId),
  teams: list.filter((c) => c.kind === TemplateCategoryKind.Team),
  childrenOf: (industryId: string) => list.filter((c) => c.parentId === industryId),
});

export const GetTemplateCategoryListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TEMPLATE_CATEGORY_LIST,
  description: 'get template category list',
  request: {},
  responses: {
    200: {
      description: 'Successfully get template category list.',
    },
  },
  tags: ['template'],
});

export const getTemplateCategoryList = async () => {
  return axios.get<ITemplateCategoryListVo[]>(urlBuilder(GET_TEMPLATE_CATEGORY_LIST));
};
