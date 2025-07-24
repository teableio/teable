import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const BUTTON_CLICK_TRIGGER = '/base/{baseId}/workflow/button-click-trigger';

export const buttonClickTriggerRoSchema = z.object({
  tableId: z.string(),
  viewId: z.string().optional(),
  fieldId: z.string(),
  recordId: z.string(),
});

export type IButtonClickTriggerRo = z.infer<typeof buttonClickTriggerRoSchema>;

export const ButtonClickTriggerRoute: RouteConfig = registerRoute({
  method: 'post',
  path: BUTTON_CLICK_TRIGGER,
  description: 'button click trigger',
  summary: 'button click trigger',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: buttonClickTriggerRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'button click a base successfully',
    },
  },
  tags: ['base'],
});

export const buttonClickTrigger = async (
  baseId: string,
  buttonClickTriggerRo: IButtonClickTriggerRo
) => {
  return await axios.post<IButtonClickTriggerRo>(
    urlBuilder(BUTTON_CLICK_TRIGGER, {
      baseId,
    }),
    buttonClickTriggerRo
  );
};
