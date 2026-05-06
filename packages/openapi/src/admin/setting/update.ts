import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { mailTransportConfigSchema } from '../../mail';
import { registerRoute } from '../../utils';
import {
  gatewayModelProviderSchema,
  gatewayModelSchema,
  gatewayModelTagSchema,
  gatewayModelTypeSchema,
} from './gateway-model';
import {
  chatModelAbilitySchema,
  imageModelAbilitySchema,
  modelAbilitySchema,
} from './model-ability';
import { pricingSchema } from './pricing';

export enum LLMProviderType {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
  AZURE = 'azure',
  COHERE = 'cohere',
  MISTRAL = 'mistral',
  DEEPSEEK = 'deepseek',
  QWEN = 'qwen',
  ZHIPU = 'zhipu',
  LINGYIWANWU = 'lingyiwanwu',
  XAI = 'xai',
  TOGETHERAI = 'togetherai',
  OLLAMA = 'ollama',
  AMAZONBEDROCK = 'amazonBedrock',
  OPENROUTER = 'openRouter',
  OPENAI_COMPATIBLE = 'openaiCompatible',
  // Vercel AI Gateway - unified model access via modelId
  AI_GATEWAY = 'aiGateway',
  // Claude Code
  CLAUDE_CODE = 'claudeCode',
}

// Model-specific configuration - unified structure for all model types
// Supports both new pricing (USD) and legacy rates (credits/1M) for backward compatibility
export const modelConfigSchema = z.object({
  // === Display name (optional, falls back to model ID if not set) ===
  label: z.string().optional(),

  // === Pricing in USD (new format - preferred) ===
  pricing: pricingSchema.optional(),

  // === Legacy rates in credits per 1M tokens (deprecated, for backward compat) ===
  // @deprecated Use pricing instead. Will be auto-converted to pricing when reading.
  inputRate: z.number().min(0).optional(),
  outputRate: z.number().min(0).optional(),
  cacheReadRate: z.number().min(0).optional(),
  cacheWriteRate: z.number().min(0).optional(),
  reasoningRate: z.number().min(0).optional(),
  imageRate: z.number().min(0).optional(),
  webSearchRate: z.number().min(0).optional(),

  // === Model type flags ===
  isImageModel: z.boolean().optional(),

  // === Test results (from actual testing) ===
  ability: modelAbilitySchema.optional(),
  imageAbility: imageModelAbilitySchema.optional(),
  testedAt: z.number().optional(),

  // === API metadata (unified with gateway models) ===
  ownedBy: gatewayModelProviderSchema.optional(), // e.g., "openai", "anthropic", "google"
  modelType: gatewayModelTypeSchema.optional(), // e.g., "language", "image"
  tags: z.array(gatewayModelTagSchema).optional(), // e.g., ["vision", "tool-use", "reasoning"]
  contextWindow: z.number().optional(), // max input tokens
  maxTokens: z.number().optional(), // max output tokens
  description: z.string().optional(), // model description
});

export type IModelConfig = z.infer<typeof modelConfigSchema>;

export const llmProviderSchema = z.object({
  type: z.enum(LLMProviderType),
  name: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  models: z.string().default(''),
  isInstance: z.boolean().optional(),
  // Model-specific configurations keyed by model name
  modelConfigs: z.record(z.string(), modelConfigSchema).optional(),
});

export type LLMProvider = z.infer<typeof llmProviderSchema>;

export const chatModelSchema = z.object({
  lg: z.string().optional(),
  md: z.string().optional(),
  sm: z.string().optional(),
  ability: chatModelAbilitySchema.optional(),
});

// Attachment transfer mode test result for a single mode
export const attachmentModeTestResultSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

export type IAttachmentModeTestResult = z.infer<typeof attachmentModeTestResultSchema>;

// Attachment transfer test results (from dual-mode testing)
export const attachmentTestSchema = z.object({
  // URL mode test result
  urlMode: attachmentModeTestResultSchema.optional(),
  // Base64 mode test result
  base64Mode: attachmentModeTestResultSchema.optional(),
  // Last test time (ISO 8601)
  testedAt: z.string().optional(),
  // PUBLIC_ORIGIN at test time (to detect config changes)
  testedOrigin: z.string().optional(),
  // Recommended mode based on test results
  recommendedMode: z.enum(['url', 'base64']).optional(),
});

export type IAttachmentTest = z.infer<typeof attachmentTestSchema>;

// Attachment transfer mode values
export const AttachmentTransferModeValues = ['url', 'base64'] as const;
export type AttachmentTransferMode = (typeof AttachmentTransferModeValues)[number];
export const attachmentTransferModeSchema = z.enum(AttachmentTransferModeValues);

// Task types for AI concurrency group routing
export const TaskTypeValues = ['text', 'image'] as const;
export type TaskType = (typeof TaskTypeValues)[number];
export const taskTypeSchema = z.enum(TaskTypeValues);

// API key entry within a concurrency group (with verification status)
export const concurrencyKeyEntrySchema = z.object({
  apiKey: z.string(),
  status: z.enum(['verified', 'untested', 'error']).default('untested'),
});

export type IConcurrencyKeyEntry = z.infer<typeof concurrencyKeyEntrySchema>;

// Named group of API keys sharing a concurrency pool, scoped to specific task types
export const concurrencyGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  taskTypes: z.array(taskTypeSchema).default([]),
  keys: z.array(concurrencyKeyEntrySchema).default([]),
  perKey: z.number().min(1).max(100).default(5).optional(),
});

export type IConcurrencyGroup = z.infer<typeof concurrencyGroupSchema>;

// Vertex BYOK credential for free quota optimization via AI Gateway BYOK
// @see https://vercel.com/docs/ai-gateway/authentication-and-byok/byok#credential-structure-by-provider
export const vertexByokCredentialSchema = z.object({
  project: z.string(),
  location: z.string(),
  googleCredentials: z.object({
    privateKey: z.string(),
    clientEmail: z.string(),
  }),
});

export type IVertexByokCredential = z.infer<typeof vertexByokCredentialSchema>;

export const aiConfigSchema = z.object({
  llmProviders: z.array(llmProviderSchema).default([]),
  embeddingModel: z.string().optional(),
  translationModel: z.string().optional(),
  chatModel: chatModelSchema.nullable().optional(),
  // AI Gateway models (admin-maintained, recommended for Cloud)
  gatewayModels: z.array(gatewayModelSchema).optional(),
  capabilities: z
    .object({
      disableActions: z.array(z.string()).optional(),
      disableModelSelection: z.boolean().optional(),
    })
    .optional(),
  // Vercel AI Gateway configuration
  aiGatewayApiKey: z.string().nullable().optional(),
  // AI Gateway base URL (defaults to Vercel's gateway if not set)
  aiGatewayBaseUrl: z.url().nullable().optional(),
  // Attachment transfer test results (from dual-mode testing)
  attachmentTest: attachmentTestSchema.nullable().optional(),
  // Attachment transfer mode: 'url' (default) or 'base64'
  attachmentTransferMode: attachmentTransferModeSchema.nullable().optional(),
  // Multiple AI Gateway API keys for concurrency scaling via key rotation
  aiGatewayApiKeys: z.array(z.string()).optional(),
  // Vertex AI BYOK credential (free quota optimization for Google models)
  vertexByokCredential: vertexByokCredentialSchema.optional(),
  // Named concurrency groups: each group owns a set of API keys and task types
  concurrencyGroups: z.array(concurrencyGroupSchema).optional(),
  // Default concurrency slots per API key (applies when groups don't specify perKey)
  concurrencyPerKey: z.number().min(1).max(100).optional(),
});

export type IAIConfig = z.infer<typeof aiConfigSchema>;

export const aiConfigVoSchema = aiConfigSchema.extend({
  enable: z.boolean().optional(),
});

export const appConfigSchema = z.object({
  vercelToken: z.string().optional(),
  customDomain: z.string().optional(),
  // Proxy URL for Vercel API (Cloudflare Workers reverse proxy)
  vercelBaseUrl: z.url().optional(),
});

export type IAppConfig = z.infer<typeof appConfigSchema>;

export const webSearchConfigSchema = z.object({
  apiKey: z.string().optional(),
});

export type IWebSearchConfig = z.infer<typeof webSearchConfigSchema>;

// V2 feature names for canary control
export const v2FeatureSchema = z.enum([
  'getRecords',
  'createTable',
  'restoreTable',
  'schemaIntegrity',
  'createRecord',
  'formSubmit',
  'updateRecord',
  'updateRecords',
  'deleteRecord',
  'duplicateRecord',
  'duplicateTable',
  'reorderRecords',
  'paste',
  'clear',
  'importRecords',
  'importBase',
  'createField',
  'deleteField',
  'deleteTable',
  'duplicateField',
  'updateField',
  'convertField',
]);

export type V2Feature = z.infer<typeof v2FeatureSchema>;

export const canaryConfigSchema = z.object({
  enabled: z.boolean(),
  spaceIds: z.array(z.string()).default([]),
  // Force all requests to use V2 (highest priority)
  forceV2All: z.boolean().optional(),
});

export type ICanaryConfig = z.infer<typeof canaryConfigSchema>;

// Header name for canary release override
export const X_CANARY_HEADER = 'x-teable-canary';

export const sandboxAgentModelSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const SANDBOX_AGENT_EFFORT_VALUES = [
  'auto',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export const sandboxAgentEffortSchema = z.enum(SANDBOX_AGENT_EFFORT_VALUES);
export type EffortLevel = z.infer<typeof sandboxAgentEffortSchema>;
export const DEFAULT_SANDBOX_AGENT_EFFORT: EffortLevel = 'auto';

export type ISandboxAgentModel = z.infer<typeof sandboxAgentModelSchema>;

export const sandboxAgentConfigSchema = z.object({
  spaceIds: z.array(z.string()).default([]),
  forceAll: z.boolean().optional(),
  defaultAgent: z.enum(['claude']).default('claude').optional(),
  models: z.record(z.string(), z.array(sandboxAgentModelSchema)).optional().default({}),
  maxDuration: z.number().min(1).max(1440).default(300).optional(),
  maxIdleTime: z.number().min(60).max(7200).default(1800).optional(),
  maxConcurrentChats: z.number().min(1).max(20).default(3).optional(),
  activeSnapshotId: z.string().optional(),
  activeAppBuilderSnapshotId: z.string().optional(),
  defaultEffort: sandboxAgentEffortSchema.default(DEFAULT_SANDBOX_AGENT_EFFORT).optional(),
});

export type ISandboxAgentConfig = z.infer<typeof sandboxAgentConfigSchema>;

export const X_SANDBOX_AGENT_HEADER = 'x-teable-sandbox-agent';

export const imTelegramConfigSchema = z.object({
  botToken: z.string(),
  botUsername: z.string(),
});

export const imFeishuConfigSchema = z.object({
  appId: z.string(),
  appSecret: z.string(),
  botName: z.string().optional(),
});

export const imConfigSchema = z.object({
  telegram: imTelegramConfigSchema.nullable().optional(),
  feishu: imFeishuConfigSchema.nullable().optional(),
});

export type IImConfig = z.infer<typeof imConfigSchema>;

export const updateSettingRoSchema = z.object({
  disallowSignUp: z.boolean().optional(),
  disallowSpaceCreation: z.boolean().optional(),
  disallowSpaceInvitation: z.boolean().optional(),
  enableEmailVerification: z.boolean().optional(),
  enableCreditReward: z.boolean().optional(),
  aiConfig: aiConfigVoSchema.optional(),
  enableWaitlist: z.boolean().optional(),
  appConfig: appConfigSchema.optional(),
  brandName: z.string().optional(),
  canaryConfig: canaryConfigSchema.optional(),
  sandboxAgentConfig: sandboxAgentConfigSchema.optional(),
  notifyMailTransportConfig: mailTransportConfigSchema.nullable().optional(),
  automationMailTransportConfig: mailTransportConfigSchema.nullable().optional(),
  imConfig: imConfigSchema.nullable().optional(),
});

export type IUpdateSettingRo = z.infer<typeof updateSettingRoSchema>;

export const UPDATE_SETTING = '/admin/setting';

export const UpdateSettingRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_SETTING,
  description: 'Get the instance settings',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateSettingRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Update settings successfully.',
    },
  },
  tags: ['admin'],
});

export const updateSetting = async (updateSettingRo: IUpdateSettingRo) => {
  return axios.patch(UPDATE_SETTING, updateSettingRo);
};
