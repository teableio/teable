import type {
  IGatewayModel,
  GatewayModelType,
  GatewayModelTag,
  GatewayModelProvider,
} from '@teable/openapi';

// Recommended model IDs - all details fetched from API
export const RECOMMENDED_MODEL_IDS = [
  // Language models
  'anthropic/claude-sonnet-4.5', // Best quality
  'anthropic/claude-haiku-4.5', // Fast & cheap
  'openai/gpt-5.2', // OpenAI flagship
  'google/gemini-3-pro-preview', // Google flagship
  // Image generation
  'google/gemini-3-pro-image', // Multimodal image generation
  'xai/grok-4', // Grok
];

// API response model structure from backend (camelCase, converted from Vercel AI Gateway snake_case)
export interface IGatewayModelAPI {
  id: string;
  object?: string;
  created?: number;
  ownedBy?: GatewayModelProvider;
  name?: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
  type?: GatewayModelType;
  tags?: GatewayModelTag[];
  pricing?: {
    input?: string; // Price per token in USD, e.g., "0.00000006"
    output?: string;
    inputCacheRead?: string;
    inputCacheWrite?: string;
    webSearch?: string; // Price per web search query in credits
  };
}

export interface IGatewayModelsStepProps {
  gatewayModels: IGatewayModel[];
  onChange: (models: IGatewayModel[]) => void;
  disabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  /** Whether to show pricing-related UI. Defaults to true (Cloud). */
  showPricing?: boolean;
}

export interface ITestState {
  testing: boolean;
  result?: 'success' | 'error';
  message?: string;
}
