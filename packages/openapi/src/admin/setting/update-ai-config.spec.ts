import { describe, expect, it } from 'vitest';
import { LLMProviderType } from './update';
import { updateAiConfigRoSchema, updateAppConfigRoSchema } from './update-ai-config';

describe('updateAiConfigRoSchema', () => {
  it('accepts a section-scoped AI config patch', () => {
    const result = updateAiConfigRoSchema.safeParse({
      section: 'llmApi',
      patch: {
        llmProviders: [{ type: LLMProviderType.OPENAI, name: 'custom', models: 'gpt-4o' }],
        aiGatewayApiKey: null,
      },
    });

    expect(result.success).toBe(true);
  });

  it('strips fields outside the selected AI config section', () => {
    const result = updateAiConfigRoSchema.parse({
      section: 'defaultModels',
      patch: {
        chatModel: { lg: 'openai@gpt-4o@teable' },
        aiGatewayApiKey: 'sk-should-not-pass',
      },
    });

    expect(result.patch).toEqual({ chatModel: { lg: 'openai@gpt-4o@teable' } });
  });
});

describe('updateAppConfigRoSchema', () => {
  it('accepts a section-scoped app config patch', () => {
    const result = updateAppConfigRoSchema.safeParse({
      section: 'apiProxy',
      patch: {
        vercelBaseUrl: 'https://proxy.example.com',
      },
    });

    expect(result.success).toBe(true);
  });
});
