import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { llmProviderSchema, chatModelAbilitySchema, LLMProviderType } from './update';

/**
 * Request schema for batch testing all LLM models
 * If providers are not specified, it will use the configured providers from settings
 */
export const batchTestLLMRoSchema = z
  .object({
    providers: z.array(llmProviderSchema.omit({ modelConfigs: true }).required()).optional(),
  })
  .optional();

export type IBatchTestLLMRo = z.infer<typeof batchTestLLMRoSchema>;

/**
 * Result for a single model test
 */
export const modelTestResultSchema = z.object({
  modelKey: z.string(),
  providerName: z.string(),
  providerType: z.enum(LLMProviderType),
  model: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  ability: chatModelAbilitySchema.optional(),
});

export type IModelTestResult = z.infer<typeof modelTestResultSchema>;

/**
 * Response schema for batch test
 */
export const batchTestLLMVoSchema = z.object({
  totalModels: z.number(),
  testedModels: z.number(),
  successCount: z.number(),
  failedCount: z.number(),
  results: z.array(modelTestResultSchema),
});

export type IBatchTestLLMVo = z.infer<typeof batchTestLLMVoSchema>;

export const BATCH_TEST_LLM = '/admin/setting/batch-test-llm';

export const BatchTestLLMRoute: RouteConfig = registerRoute({
  method: 'post',
  path: BATCH_TEST_LLM,
  description:
    'Batch test all configured LLM models to verify compatibility with AI field features',
  request: {
    body: {
      content: {
        'application/json': {
          schema: batchTestLLMRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Batch test results',
      content: {
        'application/json': {
          schema: batchTestLLMVoSchema,
        },
      },
    },
  },
  tags: ['admin', 'setting'],
});

export const batchTestLLM = async (data?: IBatchTestLLMRo): Promise<IBatchTestLLMVo> => {
  const response = await axios.post<IBatchTestLLMVo>(BATCH_TEST_LLM, data ?? {});
  return response.data;
};
