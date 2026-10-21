import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const DEVICE_DECISION = '/oauth/device/decision';

export const deviceDecisionRoSchema = z.object({
  userCode: z.string(),
  approve: z.boolean(),
});

export type IDeviceDecisionRo = z.infer<typeof deviceDecisionRoSchema>;

export const deviceDecisionRoute = registerRoute({
  method: 'post',
  path: DEVICE_DECISION,
  description: 'Approve or deny a device authorization request',
  request: {
    body: {
      content: {
        'application/json': {
          schema: deviceDecisionRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Decision recorded',
    },
  },
  tags: ['oauth'],
});

export const deviceDecision = async (ro: IDeviceDecisionRo) => {
  return axios.post<void>(DEVICE_DECISION, ro);
};
