import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { mailTransportConfigSchema } from '../../mail';
import { registerRoute } from '../../utils';
import { modelTierIdSchema } from './model-tier';
import { aiConfigVoSchema, appConfigSchema, canaryConfigSchema, imConfigSchema } from './update';

/**
 * Admin setting APIs never return a stored secret: each one comes back as this prefix plus
 * a fingerprint of the secret, and sending it back unchanged keeps the stored secret.
 */
export const MASKED_SECRET_PREFIX = 'teable_masked_v1:';

export const isMaskedSecret = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(MASKED_SECRET_PREFIX);

export const settingVoSchema = z.object({
  instanceId: z.string(),
  brandName: z.string().nullable().optional(),
  brandLogo: z.string().nullable().optional(),
  disallowSignUp: z.boolean().nullable().optional(),
  bannedEmailDomains: z.array(z.string()).nullable().optional(),
  disallowSpaceCreation: z.boolean().nullable().optional(),
  disallowSpaceInvitation: z.boolean().nullable().optional(),
  disallowDashboard: z.boolean().nullable().optional(),
  enableEmailVerification: z.boolean().nullable().optional(),
  enableWaitlist: z.boolean().nullable().optional(),
  enableCreditReward: z.boolean().nullable().optional(),
  aiConfig: aiConfigVoSchema.nullable().optional(),
  /** Read-only, computed by the server: credit ratio of each chat tier against the default tier. */
  aiChatTierCreditRatio: z.partialRecord(modelTierIdSchema, z.number()).optional(),
  /**
   * Read-only, computed by the server: secrets this edition reads that are unset
   * or still on their publicly known default. Env var names only, never values.
   * Left out while SECRET_ADMIN_TOOLS_ENABLED is off.
   */
  insecureSecrets: z
    .array(z.object({ envKey: z.string(), reason: z.enum(['missing', 'publicDefault']) }))
    .optional(),
  notifyMailTransportConfig: mailTransportConfigSchema.nullable().optional(),
  automationMailTransportConfig: mailTransportConfigSchema.nullable().optional(),
  appConfig: appConfigSchema.nullable().optional(),
  canaryConfig: canaryConfigSchema.nullable().optional(),
  trashCleanupEnabledAt: z.string().nullable().optional(),
  imConfig: imConfigSchema.nullable().optional(),
  createdTime: z.string().optional(),
});

export type ISettingVo = z.infer<typeof settingVoSchema>;

export const GET_SETTING = '/admin/setting';

export const GetSettingRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SETTING,
  description: 'Get the instance settings',
  request: {},
  responses: {
    200: {
      description: 'Returns the instance settings.',
      content: {
        'application/json': {
          schema: settingVoSchema,
        },
      },
    },
  },
  tags: ['admin'],
});

export const getSetting = async () => {
  return axios.get<ISettingVo>(GET_SETTING);
};
