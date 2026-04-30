export enum ImageGenerationInputMode {
  None = 'none',
  MultimodalMessage = 'multimodal-message',
  ImageEditPrompt = 'image-edit-prompt',
}

export interface IImageGenerationInputCapabilityRule {
  provider: string;
  modelPrefix: string;
  requiredTags: readonly string[];
  mode: ImageGenerationInputMode;
}

/**
 * Provider/model specific rules for image generation models that can consume input images.
 *
 * AI Gateway currently exposes generic `image-generation` and `vision` tags but
 * does not expose a distinct image-to-image/image-edit capability. Keep the
 * rule registry here so adding future model families is localized.
 */
export const IMAGE_GENERATION_INPUT_CAPABILITY_RULES: readonly IImageGenerationInputCapabilityRule[] =
  [
    {
      provider: 'openai',
      modelPrefix: 'gpt-image-',
      requiredTags: ['image-generation'],
      mode: ImageGenerationInputMode.ImageEditPrompt,
    },
    {
      provider: 'google',
      modelPrefix: 'gemini-',
      requiredTags: ['image-generation'],
      mode: ImageGenerationInputMode.MultimodalMessage,
    },
  ];

const parseGatewayModelId = (modelId: string): { provider: string; model: string } => {
  const [provider, ...modelParts] = modelId.split('/');
  return {
    provider,
    model: modelParts.join('/'),
  };
};

/**
 * Resolve how image attachments should be passed to an image generation model.
 */
export function getImageGenerationInputMode(
  modelId: string,
  tags: readonly string[] = []
): ImageGenerationInputMode {
  const { provider, model } = parseGatewayModelId(modelId);

  const matchedRule = IMAGE_GENERATION_INPUT_CAPABILITY_RULES.find((rule) => {
    return (
      rule.provider === provider &&
      model.startsWith(rule.modelPrefix) &&
      rule.requiredTags.every((tag) => tags.includes(tag))
    );
  });

  return matchedRule?.mode ?? ImageGenerationInputMode.None;
}

/**
 * Whether the model can consume input images while generating output images.
 */
export function supportsImageInputForImageGeneration(
  modelId: string,
  tags: readonly string[] = []
): boolean {
  return getImageGenerationInputMode(modelId, tags) !== ImageGenerationInputMode.None;
}

/**
 * Whether the model should receive image attachments through AI SDK generateImage prompt.images.
 */
export function supportsImageEditPromptForImageGeneration(
  modelId: string,
  tags: readonly string[] = []
): boolean {
  return getImageGenerationInputMode(modelId, tags) === ImageGenerationInputMode.ImageEditPrompt;
}
