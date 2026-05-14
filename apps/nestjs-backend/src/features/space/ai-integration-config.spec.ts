import { LLMProviderType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import {
  generateByokProviderName,
  normalizeSpaceAIIntegrationConfig,
} from './ai-integration-config';

describe('space AI integration config', () => {
  it('generates a readable BYOK provider name', () => {
    expect(generateByokProviderName([], () => 'a7k2')).toBe('byok-a7k2');
  });

  it('fills missing provider names without changing existing names', () => {
    const config = normalizeSpaceAIIntegrationConfig({
      llmProviders: [
        {
          type: LLMProviderType.OPENAI,
          name: '',
          baseUrl: 'https://api.openai.com/v1',
          models: 'gpt-5.5',
        },
        {
          type: LLMProviderType.ANTHROPIC,
          name: 'custom-anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          models: 'claude-sonnet-4-6',
        },
      ],
    });

    expect(config.llmProviders[0].name).toMatch(/^byok-[0-9a-z]{4}$/);
    expect(config.llmProviders[1].name).toBe('custom-anthropic');
  });

  it('rejects the reserved instance provider name for space BYOK providers', () => {
    expect(() =>
      normalizeSpaceAIIntegrationConfig({
        llmProviders: [
          {
            type: LLMProviderType.OPENAI,
            name: 'teable',
            models: 'gpt-5.5',
          },
        ],
      })
    ).toThrow('AI provider name is reserved');
  });

  it('rejects duplicate provider names in one space config', () => {
    expect(() =>
      normalizeSpaceAIIntegrationConfig({
        llmProviders: [
          {
            type: LLMProviderType.OPENAI,
            name: 'custom-provider',
            models: 'gpt-5.5',
          },
          {
            type: LLMProviderType.ANTHROPIC,
            name: 'CUSTOM-PROVIDER',
            models: 'claude-sonnet-4-6',
          },
        ],
      })
    ).toThrow('AI provider name must be unique within the space');
  });
});
