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

  it("rejects a modelPool patch with a gateway model id containing '@'", () => {
    const result = updateAiConfigRoSchema.safeParse({
      section: 'modelPool',
      patch: {
        gatewayModels: [{ id: 'custom/image-model@beta', label: 'Image Model Beta' }],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a modelConfigs patch with a gateway model id containing '@'", () => {
    const result = updateAiConfigRoSchema.safeParse({
      section: 'modelConfigs',
      patch: {
        gatewayModels: [{ id: 'custom/image-model@beta', label: 'Image Model Beta' }],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a defaultModels patch whose chat model key has extra '@' segments", () => {
    // A live gateway id like 'custom/image-model@beta' bypasses gatewayModelSchema,
    // so the malformed 4-segment key must be caught here.
    const result = updateAiConfigRoSchema.safeParse({
      section: 'defaultModels',
      patch: {
        chatModel: { lg: 'aiGateway@custom/image-model@beta@teable' },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a defaultModels patch whose embedding model key has extra '@' segments", () => {
    const result = updateAiConfigRoSchema.safeParse({
      section: 'defaultModels',
      patch: {
        embeddingModel: 'aiGateway@custom/embed@v2@teable',
      },
    });

    expect(result.success).toBe(false);
  });

  it('accepts a defaultModels patch with well-formed keys and null clears', () => {
    const result = updateAiConfigRoSchema.safeParse({
      section: 'defaultModels',
      patch: {
        chatModel: { lg: 'aiGateway@anthropic/claude-sonnet-4@teable' },
        embeddingModel: 'openai@text-embedding-3-small@teable',
        translationModel: null,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a modelMappings patch whose target model key has extra '@' segments", () => {
    const result = updateAiConfigRoSchema.safeParse({
      section: 'modelMappings',
      patch: {
        modelMappings: [
          {
            sourceModelKey: 'aiGateway@anthropic/claude-sonnet-4@teable',
            targetModelKey: 'aiGateway@custom/image-model@beta@teable',
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an llmApi patch with a provider models list containing '@'", () => {
    const result = updateAiConfigRoSchema.safeParse({
      section: 'llmApi',
      patch: {
        llmProviders: [
          { type: LLMProviderType.OPENAI, name: 'custom', models: 'gpt-4o,model@version' },
        ],
      },
    });

    expect(result.success).toBe(false);
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
