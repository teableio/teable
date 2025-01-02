import type { ISimpleLLMProvider } from '@teable/openapi';

export const generateModelKeyList = (llmProviders: ISimpleLLMProvider[]) => {
  return llmProviders
    .map(({ models, type, name }) => models.split(',').map((model) => `${type}@${model}@${name}`))
    .flat();
};

export const parseModelKey = (modelKey: string | undefined) => {
  if (!modelKey) return {};
  const [type, model, name] = modelKey.split('@');
  return { type, model, name };
};
