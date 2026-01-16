import type { IGatewayModel } from '@teable/openapi';
import type { IGatewayModelAPI } from './types';

// Helper to format USD price for display
export function formatUsdPriceShort(price: string | undefined): string {
  if (!price) return '-';
  const num = parseFloat(price);
  if (isNaN(num) || num === 0) return 'Free';
  // Convert to per-million rate for readability
  // e.g., "0.000003" -> "$3/M"
  const perMillion = num * 1_000_000;
  if (perMillion < 1) return `$${perMillion.toFixed(2)}/M`;
  if (perMillion < 100) return `$${perMillion.toFixed(1)}/M`;
  return `$${Math.round(perMillion)}/M`;
}

// Generate a display label from model ID or API name
export function generateLabelFromId(modelId: string, apiName?: string): string {
  if (apiName) return apiName;
  const parts = modelId.split('/');
  const modelName = parts[parts.length - 1];
  return modelName
    .replace(/-\d{8}$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Get pricing from API model data (USD format)
export function getPricingFromApiModel(
  apiModel: IGatewayModelAPI | undefined
): IGatewayModel['pricing'] | undefined {
  if (!apiModel?.pricing) return undefined;

  const pricing: NonNullable<IGatewayModel['pricing']> = {};

  if (apiModel.pricing.input) pricing.input = apiModel.pricing.input;
  if (apiModel.pricing.output) pricing.output = apiModel.pricing.output;
  if (apiModel.pricing.inputCacheRead) pricing.inputCacheRead = apiModel.pricing.inputCacheRead;
  if (apiModel.pricing.inputCacheWrite) pricing.inputCacheWrite = apiModel.pricing.inputCacheWrite;
  if (apiModel.pricing.webSearch) pricing.webSearch = apiModel.pricing.webSearch;

  return Object.keys(pricing).length > 0 ? pricing : undefined;
}

// Detect if a model is an image generation model (via API type and tags only, not keywords)
export function detectIsImageModel(_modelId: string, apiModel?: IGatewayModelAPI): boolean {
  // Check API type first - pure image models
  if (apiModel?.type === 'image') return true;
  // Check tags for image-generation capability (multimodal LLMs)
  if (apiModel?.tags?.some((tag) => ['image-generation', 'text-to-image'].includes(tag))) {
    return true;
  }
  return false;
}

// Auto-detect capabilities from tags
export function detectCapabilitiesFromTags(
  tags?: string[]
): IGatewayModel['capabilities'] | undefined {
  if (!tags || tags.length === 0) return undefined;

  const capabilities: IGatewayModel['capabilities'] = {};

  // Map API tags to our capability fields
  const tagMapping: Record<string, keyof NonNullable<IGatewayModel['capabilities']>> = {
    vision: 'image',
    'file-input': 'pdf',
    'tool-use': 'toolCall',
    reasoning: 'reasoning',
    'image-generation': 'imageGeneration',
  };

  for (const tag of tags) {
    const capability = tagMapping[tag];
    if (capability) {
      capabilities[capability] = true;
    }
  }

  return Object.keys(capabilities).length > 0 ? capabilities : undefined;
}
