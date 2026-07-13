import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { gatewayModelSchema } from './gateway-model';
import {
  aiConfigSchema,
  aiConfigVoSchema,
  aiModelMappingSchema,
  appAuthConfigSchema,
  appConfigSchema,
  attachmentTestSchema,
  attachmentTransferModeSchema,
  chatModelSchema,
  concurrencyGroupSchema,
  llmProviderSchema,
  modelKeySchema,
  realtimeTranscriptionConfigSchema,
  vertexByokCredentialSchema,
} from './update';

const nullableStringSchema = z.string().nullable().optional();

const aiConfigLlmApiPatchSchema = z.object({
  llmProviders: z.array(llmProviderSchema).nullable().optional(),
  aiGatewayApiKey: z.string().nullable().optional(),
  aiGatewayBaseUrl: z.url().nullable().optional(),
  attachmentTest: attachmentTestSchema.nullable().optional(),
  attachmentTransferMode: attachmentTransferModeSchema.nullable().optional(),
});

const aiConfigModelPoolPatchSchema = z.object({
  gatewayModels: z.array(gatewayModelSchema).nullable().optional(),
});

const aiConfigDefaultModelsPatchSchema = z.object({
  chatModel: chatModelSchema.nullable().optional(),
  embeddingModel: modelKeySchema.nullable().optional(),
  translationModel: modelKeySchema.nullable().optional(),
});

const aiConfigCapabilitiesPatchSchema = z.object({
  capabilities: aiConfigSchema.shape.capabilities.nullable().optional(),
});

const aiConfigConcurrencyPatchSchema = z.object({
  concurrencyGroups: z.array(concurrencyGroupSchema).nullable().optional(),
  aiGatewayApiKeys: z.array(z.string()).nullable().optional(),
  concurrencyPerKey: z.number().min(1).max(100).nullable().optional(),
});

const aiConfigVertexCredentialPatchSchema = z.object({
  vertexByokCredential: vertexByokCredentialSchema.nullable().optional(),
});

const aiConfigModelMappingsPatchSchema = z.object({
  modelMappings: z.array(aiModelMappingSchema).nullable().optional(),
});

const aiConfigModelConfigsPatchSchema = z.object({
  llmProviders: z.array(llmProviderSchema).nullable().optional(),
  gatewayModels: z.array(gatewayModelSchema).nullable().optional(),
});

const aiConfigRealtimeTranscriptionPatchSchema = z.object({
  realtimeTranscription: realtimeTranscriptionConfigSchema.nullable().optional(),
});

export const updateAiConfigRoSchema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('llmApi'), patch: aiConfigLlmApiPatchSchema }),
  z.object({ section: z.literal('modelPool'), patch: aiConfigModelPoolPatchSchema }),
  z.object({ section: z.literal('defaultModels'), patch: aiConfigDefaultModelsPatchSchema }),
  z.object({ section: z.literal('capabilities'), patch: aiConfigCapabilitiesPatchSchema }),
  z.object({ section: z.literal('concurrency'), patch: aiConfigConcurrencyPatchSchema }),
  z.object({ section: z.literal('vertexCredential'), patch: aiConfigVertexCredentialPatchSchema }),
  z.object({ section: z.literal('modelMappings'), patch: aiConfigModelMappingsPatchSchema }),
  z.object({ section: z.literal('modelConfigs'), patch: aiConfigModelConfigsPatchSchema }),
  z.object({
    section: z.literal('realtimeTranscription'),
    patch: aiConfigRealtimeTranscriptionPatchSchema,
  }),
]);

export type IUpdateAiConfigRo = z.infer<typeof updateAiConfigRoSchema>;
export type IUpdateAiConfigSection = IUpdateAiConfigRo['section'];
export type IUpdateAiConfigPatch = IUpdateAiConfigRo['patch'];

export const updateAiConfigVoSchema = z.object({
  aiConfig: aiConfigVoSchema.partial(),
});

export type IUpdateAiConfigVo = z.infer<typeof updateAiConfigVoSchema>;

const appConfigEnginePatchSchema = z.object({
  vercelToken: nullableStringSchema,
});

const appConfigCustomDomainPatchSchema = z.object({
  customDomain: nullableStringSchema,
});

const appConfigApiProxyPatchSchema = z.object({
  vercelBaseUrl: z.url().nullable().optional(),
});

const appConfigAppAuthPatchSchema = z.object({
  appAuth: appAuthConfigSchema.nullable().optional(),
});

const appConfigBrandingPatchSchema = z.object({
  badgeEnabled: z.boolean(),
});

export const updateAppConfigRoSchema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('engine'), patch: appConfigEnginePatchSchema }),
  z.object({ section: z.literal('customDomain'), patch: appConfigCustomDomainPatchSchema }),
  z.object({ section: z.literal('apiProxy'), patch: appConfigApiProxyPatchSchema }),
  z.object({ section: z.literal('appAuth'), patch: appConfigAppAuthPatchSchema }),
  z.object({ section: z.literal('branding'), patch: appConfigBrandingPatchSchema }),
]);

export type IUpdateAppConfigRo = z.infer<typeof updateAppConfigRoSchema>;
export type IUpdateAppConfigSection = IUpdateAppConfigRo['section'];
export type IUpdateAppConfigPatch = IUpdateAppConfigRo['patch'];

export const updateAppConfigVoSchema = z.object({
  appConfig: appConfigSchema.partial(),
});

export type IUpdateAppConfigVo = z.infer<typeof updateAppConfigVoSchema>;

export const UPDATE_AI_CONFIG = '/admin/setting/ai-config';
export const UPDATE_APP_CONFIG = '/admin/setting/app-config';

export const UpdateAiConfigRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_AI_CONFIG,
  description: 'Update one AI configuration section',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateAiConfigRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Update AI configuration section successfully.',
      content: {
        'application/json': {
          schema: updateAiConfigVoSchema,
        },
      },
    },
  },
  tags: ['admin'],
});

export const UpdateAppConfigRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_APP_CONFIG,
  description: 'Update one App Builder configuration section',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateAppConfigRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Update App Builder configuration section successfully.',
      content: {
        'application/json': {
          schema: updateAppConfigVoSchema,
        },
      },
    },
  },
  tags: ['admin'],
});

export const updateAiConfig = async (updateAiConfigRo: IUpdateAiConfigRo) => {
  return axios.patch<IUpdateAiConfigVo>(UPDATE_AI_CONFIG, updateAiConfigRo);
};

export const updateAppConfig = async (updateAppConfigRo: IUpdateAppConfigRo) => {
  return axios.patch<IUpdateAppConfigVo>(UPDATE_APP_CONFIG, updateAppConfigRo);
};
