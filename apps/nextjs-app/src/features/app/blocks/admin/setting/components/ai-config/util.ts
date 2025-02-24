import type { ISimpleLLMProvider } from '@teable/openapi';

export const generateModelKeyList = (llmProviders: ISimpleLLMProvider[]) => {
  return llmProviders
    .map(({ models, type, name, isInstance }) =>
      models.split(',').map((model) => ({ modelKey: `${type}@${model}@${name}`, isInstance }))
    )
    .flat();
};

export const parseModelKey = (modelKey: string | undefined) => {
  if (!modelKey) return {};
  const [type, model, name] = modelKey.split('@');
  return { type, model, name };
};

export const decimalToRatio = (decimal: number): string => {
  if (decimal >= 1 || decimal <= 0) return '1:1';

  const decimalStr = decimal.toString();

  const parts = decimalStr.split('.');
  const decimalPlaces = parts[1]?.length || 0;

  const numerator = 1;
  const denominator = Math.ceil(Math.pow(10, decimalPlaces) / Number(decimalStr.replace('.', '')));

  return `${numerator}:${denominator}`;
};
