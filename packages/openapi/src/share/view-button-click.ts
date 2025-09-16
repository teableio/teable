import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../axios';
import type { IButtonClickVo } from '../record/button-click';
import { buttonClickVoSchema } from '../record/button-click';
import { registerRoute, urlBuilder } from '../utils';

export const SHARE_VIEW_BUTTON_CLICK =
  '/share/{shareId}/view/record/{recordId}/{fieldId}/button-click';

export const ShareViewButtonClickRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SHARE_VIEW_BUTTON_CLICK,
  summary: 'Button click',
  description: 'Button click',
  request: {
    params: z.object({
      shareId: z.string(),
      recordId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the clicked cell',
      content: {
        'application/json': {
          schema: buttonClickVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export async function shareViewButtonClick(shareId: string, recordId: string, fieldId: string) {
  return axios.post<IButtonClickVo>(
    urlBuilder(SHARE_VIEW_BUTTON_CLICK, { shareId, recordId, fieldId })
  );
}
