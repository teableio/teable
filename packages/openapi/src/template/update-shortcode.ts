import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_TEMPLATE_SHORTCODE = '/template/{templateId}/shortcode';

export const updateShortcodeRoSchema = z.object({
  shortcode: z
    .string()
    .regex(
      /^[a-z0-9-]{3,50}$/,
      'Shortcode must be 3-50 characters (lowercase letters, numbers, hyphens only)'
    )
    .describe('Human-readable shortcode for the template permalink'),
});

export type IUpdateShortcodeRo = z.infer<typeof updateShortcodeRoSchema>;

export const updateShortcodeVoSchema = z.object({
  shortcode: z.string(),
  permalink: z.string(),
});

export type IUpdateShortcodeVo = z.infer<typeof updateShortcodeVoSchema>;

export const UpdateTemplateShortcodeRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_TEMPLATE_SHORTCODE,
  description: 'Update or set template shortcode for permalink',
  summary: 'Update template shortcode',
  request: {
    params: z.object({
      templateId: z.string().startsWith(IdPrefix.Template),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateShortcodeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully updated template shortcode.',
      content: {
        'application/json': {
          schema: updateShortcodeVoSchema,
        },
      },
    },
  },
  tags: ['template'],
});

export const updateTemplateShortcode = async (
  templateId: string,
  updateShortcodeRo: IUpdateShortcodeRo
) => {
  return axios.patch<IUpdateShortcodeVo>(
    urlBuilder(UPDATE_TEMPLATE_SHORTCODE, { templateId }),
    updateShortcodeRo
  );
};

export const DELETE_TEMPLATE_SHORTCODE = '/template/{templateId}/shortcode';

export const DeleteTemplateShortcodeRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_TEMPLATE_SHORTCODE,
  description: 'Delete template shortcode',
  summary: 'Delete template shortcode',
  request: {
    params: z.object({
      templateId: z.string().startsWith(IdPrefix.Template),
    }),
  },
  responses: {
    200: {
      description: 'Successfully deleted template shortcode.',
    },
  },
  tags: ['template'],
});

export const deleteTemplateShortcode = async (templateId: string) => {
  return axios.delete(urlBuilder(DELETE_TEMPLATE_SHORTCODE, { templateId }));
};
