import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { mailTransportConfigSchema } from '../../mail';
import { registerRoute } from '../../utils';

export const SET_SETTING_MAIL_TRANSPORT_CONFIG = '/admin/setting/set-mail-transport-config';

const nameSchema = z
  .literal('notifyMailTransportConfig')
  .or(z.literal('automationMailTransportConfig'));

export const setSettingMailTransportConfigRoSchema = z.object({
  name: nameSchema,
  transportConfig: mailTransportConfigSchema,
});

export type ISetSettingMailTransportConfigRo = z.infer<
  typeof setSettingMailTransportConfigRoSchema
>;

export const setSettingMailTransportConfigVoSchema = z.object({
  name: nameSchema,
  transportConfig: mailTransportConfigSchema,
});

export type ISetSettingMailTransportConfigVo = z.infer<
  typeof setSettingMailTransportConfigVoSchema
>;

export const SetSettingMailTransportConfigRoute: RouteConfig = registerRoute({
  method: 'put',
  path: SET_SETTING_MAIL_TRANSPORT_CONFIG,
  description: 'Set mail transporter',
  request: {
    body: {
      content: {
        'application/json': {
          schema: setSettingMailTransportConfigRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Set mail transporter successfully.',
      content: {
        'application/json': {
          schema: setSettingMailTransportConfigVoSchema,
        },
      },
    },
  },
  tags: ['admin', 'setting'],
});

export const setSettingMailTransportConfig = async (ro: ISetSettingMailTransportConfigRo) => {
  return await axios.put<ISetSettingMailTransportConfigVo>(SET_SETTING_MAIL_TRANSPORT_CONFIG, ro);
};
