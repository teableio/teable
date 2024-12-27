import { LLMProviderType } from '@teable/openapi';

export const LLM_PROVIDERS = [
  {
    value: LLMProviderType.OPENAI,
    label: 'OpenAI',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    modelsPlaceholder: 'gpt-4, gpt-4o-mini, gpt-3.5-turbo',
  },
  {
    value: LLMProviderType.AZURE,
    label: 'Azure',
    baseUrlPlaceholder: 'https://{your-resource-name}.openai.azure.com',
    modelsPlaceholder: 'gpt-4, gpt-35-turbo',
  },
  {
    value: LLMProviderType.ANTHROPIC,
    label: 'Anthropic',
    baseUrlPlaceholder: 'https://api.anthropic.com',
    modelsPlaceholder: 'claude-3-opus-20240229, claude-3-5-sonnet-20241022',
  },
  {
    value: LLMProviderType.GOOGLE,
    label: 'Google',
    baseUrlPlaceholder: 'https://generativelanguage.googleapis.com',
    modelsPlaceholder: 'gemini-pro-vision, gemini-1.5-flash-002',
  },
  {
    value: LLMProviderType.COHERE,
    label: 'Cohere',
    baseUrlPlaceholder: 'https://api.cohere.ai/v1',
    modelsPlaceholder: 'command-r, command-r-plus, command-r-plus-online',
  },
  {
    value: LLMProviderType.MISTRAL,
    label: 'Mistral',
    baseUrlPlaceholder: 'https://api.mistral.ai/v1',
    modelsPlaceholder: 'mistral-large-latest, open-mistral-nemo',
  },
] as const;
