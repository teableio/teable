import { LLMProviderType, MINIMAX_PROVIDER_ENDPOINTS } from '@teable/openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerMocks = vi.hoisted(() => ({
  createMessagesProvider: vi.fn(() => 'messages-provider'),
  createChatProvider: vi.fn(() => 'chat-provider'),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: providerMocks.createMessagesProvider,
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: providerMocks.createChatProvider,
}));

import { modelProviders } from './util';

describe('MiniMax provider routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the chat provider for chat completion endpoints', () => {
    const options = {
      name: 'MiniMax-M3',
      baseURL: MINIMAX_PROVIDER_ENDPOINTS[0].baseUrl,
      apiKey: 'test-key',
    };

    expect(modelProviders[LLMProviderType.MINIMAX](options)).toBe('chat-provider');
    expect(providerMocks.createChatProvider).toHaveBeenCalledWith(options);
    expect(providerMocks.createMessagesProvider).not.toHaveBeenCalled();
  });

  it('uses the messages provider for messages endpoints', () => {
    const options = {
      name: 'MiniMax-M3',
      baseURL: MINIMAX_PROVIDER_ENDPOINTS[2].baseUrl,
      apiKey: 'test-key',
    };

    expect(modelProviders[LLMProviderType.MINIMAX](options)).toBe('messages-provider');
    expect(providerMocks.createMessagesProvider).toHaveBeenCalledWith(options);
    expect(providerMocks.createChatProvider).not.toHaveBeenCalled();
  });
});
