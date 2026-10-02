import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { realtimeTranscriptionModelSchema } from '../../ai/realtime-transcription';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { gatewayModelSchema } from './gateway-model';
import { settingVoSchema } from './get';
import { chatModelSchema, llmProviderSchema } from './update';

export const simpleLLMProviderSchema = llmProviderSchema.pick({
  type: true,
  name: true,
  models: true,
  isInstance: true,
  modelConfigs: true,
});

export type ISimpleLLMProvider = z.infer<typeof simpleLLMProviderSchema>;

const publicAiConfigSchema = z.object({
  enable: z.boolean(),
  llmProviders: z.array(simpleLLMProviderSchema),
  chatModel: chatModelSchema.optional(),
  capabilities: z
    .object({
      disableActions: z.array(z.string()).optional(),
      disableModelSelection: z.boolean().optional(),
    })
    .optional(),
  // Gateway models enabled by admin (for space-level AI config)
  gatewayModels: z.array(gatewayModelSchema).optional(),
  voiceInput: z
    .object({
      enabled: z.boolean(),
      model: realtimeTranscriptionModelSchema,
      maxSessionDurationSec: z.number(),
    })
    .optional(),
});

export const publicSettingVoSchema = settingVoSchema
  .pick({
    instanceId: true,
    brandName: true,
    brandLogo: true,
    disallowSignUp: true,
    disallowSpaceCreation: true,
    disallowSpaceInvitation: true,
    disallowDashboard: true,
    enableEmailVerification: true,
    enableWaitlist: true,
    createdTime: true,
  })
  .extend({
    aiConfig: publicAiConfigSchema.nullable(),
    appGenerationEnabled: z.boolean().optional(),
    turnstileSiteKey: z.string().nullable().optional(),
    changeEmailSendCodeMailRate: z.number().optional(),
    resetPasswordSendMailRate: z.number().optional(),
    signupVerificationSendCodeMailRate: z.number().optional(),
    // Whether the login page offers "sign in with email code": password login is
    // enabled and the instance has a working notify mail transport.
    emailCodeSigninEnabled: z.boolean().optional(),
    enableCreditReward: z.boolean().optional(),
    availableIntegrationProviders: z.array(z.string()).optional(),
    // EE cloud: whether the deployment has a GitHub App for app-builder sync.
    githubAppConfigured: z.boolean().optional(),
    // The server supports the mobile app's PKCE sign-in (`POST /auth/mobile/code` + `exchange`).
    mobileAuthExchange: z.boolean().optional(),
    // Which social sign-ins this deployment has configured, in no particular order, and
    // whether email + password is off. A client that draws its own sign-in screen (the
    // mobile app) needs both to offer exactly what the server can actually answer.
    socialAuthProviders: z.array(z.string()).optional(),
    passwordLoginDisabled: z.boolean().optional(),
    // EE: whether the deployment has a scraping provider key, gating the chat Scraper entry.
    scrapeEnabled: z.boolean().optional(),
    // EE: whether the deployment can subscribe to and receive connector events (Composio key and
    // webhook secret both set), gating the connector event trigger entries.
    connectorEventEnabled: z.boolean().optional(),
    // What this server was built from, the way the Web's own settings page states it. A
    // client that is not served by this deployment (the mobile app) has no other way to
    // say which server it is talking to. Empty on a build that carries no version.
    buildVersion: z.string().optional(),
  });
export type IPublicSettingVo = z.infer<typeof publicSettingVoSchema>;

export const GET_PUBLIC_SETTING = '/admin/setting/public';
export const GetPublicSettingRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PUBLIC_SETTING,
  description: 'Get the public instance settings',
  request: {},
  responses: {
    200: {
      description: 'Returns the public instance settings.',
      content: {
        'application/json': {
          schema: publicSettingVoSchema,
        },
      },
    },
  },
  tags: ['admin'],
});

export const getPublicSetting = async () => {
  return axios.get<IPublicSettingVo>(GET_PUBLIC_SETTING);
};
