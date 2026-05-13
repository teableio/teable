import { HttpErrorCode } from '@teable/core';
import type { IAIIntegrationConfig } from '@teable/openapi';
import { BYOK_PROVIDER_NAME_PREFIX, isReservedAIProviderName } from '@teable/openapi';
import { customAlphabet } from 'nanoid';
import { CustomHttpException } from '../../custom.exception';

const createByokProviderNameSuffix = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 4);
const maxProviderNameGenerationAttempts = 20;

const normalizeProviderName = (name: string | undefined | null) => name?.trim().toLowerCase() ?? '';

export const generateByokProviderName = (
  existingNames: Iterable<string | undefined>,
  createSuffix = createByokProviderNameSuffix
) => {
  const normalizedExistingNames = new Set(
    [...existingNames].map(normalizeProviderName).filter(Boolean)
  );

  for (let i = 0; i < maxProviderNameGenerationAttempts; i++) {
    const name = `${BYOK_PROVIDER_NAME_PREFIX}${createSuffix()}`;
    if (!normalizedExistingNames.has(normalizeProviderName(name))) {
      return name;
    }
  }

  throw new CustomHttpException(
    'Unable to generate unique BYOK provider name',
    HttpErrorCode.VALIDATION_ERROR
  );
};

export const normalizeSpaceAIIntegrationConfig = (
  config: IAIIntegrationConfig
): IAIIntegrationConfig => {
  const llmProviders = config.llmProviders ?? [];
  const existingNames = llmProviders.map((provider) => provider.name);
  const usedNames = new Set<string>();

  return {
    ...config,
    llmProviders: llmProviders.map((provider) => {
      const name = provider.name?.trim() || generateByokProviderName(existingNames);
      const normalizedName = normalizeProviderName(name);

      if (isReservedAIProviderName(name)) {
        throw new CustomHttpException(
          'AI provider name is reserved',
          HttpErrorCode.VALIDATION_ERROR
        );
      }

      if (usedNames.has(normalizedName)) {
        throw new CustomHttpException(
          'AI provider name must be unique within the space',
          HttpErrorCode.VALIDATION_ERROR
        );
      }

      usedNames.add(normalizedName);
      existingNames.push(name);

      return {
        ...provider,
        name,
      };
    }),
  };
};
