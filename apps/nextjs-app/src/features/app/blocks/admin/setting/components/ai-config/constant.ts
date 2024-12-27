import { Anthropic, Azure, Cohere, GoogleLogo, Mistral, Openai } from '@teable/icons';
import { LLMProviderType } from '@teable/openapi';

export const LLM_PROVIDER_ICONS = {
  [LLMProviderType.OPENAI]: Openai,
  [LLMProviderType.ANTHROPIC]: Anthropic,
  [LLMProviderType.GOOGLE]: GoogleLogo,
  [LLMProviderType.AZURE]: Azure,
  [LLMProviderType.COHERE]: Cohere,
  [LLMProviderType.MISTRAL]: Mistral,
};

export const LLM_PROVIDERS = [
  {
    value: LLMProviderType.OPENAI,
    label: 'OpenAI',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    modelsPlaceholder: 'gpt-4,gpt-4o-mini,gpt-3.5-turbo',
    Icon: LLM_PROVIDER_ICONS[LLMProviderType.OPENAI],
  },
  {
    value: LLMProviderType.ANTHROPIC,
    label: 'Anthropic',
    baseUrlPlaceholder: 'https://api.anthropic.com',
    modelsPlaceholder: 'claude-3-opus-20240229,claude-3-5-sonnet-20241022',
    Icon: LLM_PROVIDER_ICONS[LLMProviderType.ANTHROPIC],
  },
  {
    value: LLMProviderType.GOOGLE,
    label: 'Google',
    baseUrlPlaceholder: 'https://generativelanguage.googleapis.com',
    modelsPlaceholder: 'gemini-pro-vision,gemini-1.5-flash-002',
    Icon: LLM_PROVIDER_ICONS[LLMProviderType.GOOGLE],
  },
  {
    value: LLMProviderType.AZURE,
    label: 'Azure',
    baseUrlPlaceholder: 'https://{your-resource-name}.openai.azure.com',
    modelsPlaceholder: 'gpt-4,gpt-35-turbo',
    Icon: LLM_PROVIDER_ICONS[LLMProviderType.AZURE],
  },
  {
    value: LLMProviderType.COHERE,
    label: 'Cohere',
    baseUrlPlaceholder: 'https://api.cohere.ai/v1',
    modelsPlaceholder: 'command-r,command-r-plus,command-r-plus-online',
    Icon: LLM_PROVIDER_ICONS[LLMProviderType.COHERE],
  },
  {
    value: LLMProviderType.MISTRAL,
    label: 'Mistral',
    baseUrlPlaceholder: 'https://api.mistral.ai/v1',
    modelsPlaceholder: 'mistral-large-latest,open-mistral-nemo',
    Icon: LLM_PROVIDER_ICONS[LLMProviderType.MISTRAL],
  },
] as const;
