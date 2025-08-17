import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { chatModelAbilitySchema, chatModelAbilityType, llmProviderSchema } from './update';

export const testLLMRoSchema = llmProviderSchema
  .omit({
    isInstance: true,
  })
  .required()
  .extend({
    modelKey: z.string().optional(),
    ability: z.array(chatModelAbilityType).optional(),
  });

export type ITestLLMRo = z.infer<typeof testLLMRoSchema>;

export const testLLMVoSchema = z.object({
  success: z.boolean(),
  response: z.string().optional(),
  ability: chatModelAbilitySchema.optional(),
});

export type ITestLLMVo = z.infer<typeof testLLMVoSchema>;

export const TEST_LLM = '/admin/setting/test-llm';

export const TestLLMRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TEST_LLM,
  description: 'Test LLM provider configuration',
  request: {
    body: {
      content: {
        'application/json': {
          schema: testLLMRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Test result',
      content: {
        'application/json': {
          schema: testLLMVoSchema,
        },
      },
    },
  },
  tags: ['admin', 'setting'],
});

export const testLLM = async (data: ITestLLMRo): Promise<ITestLLMVo> => {
  const response = await axios.post<ITestLLMVo>(TEST_LLM, data);
  return response.data;
};
