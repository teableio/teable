import type { IGatewayModel, IGatewayApiModel } from '@teable/openapi';

// Recommended model IDs - all details fetched from API
export const RECOMMENDED_MODEL_IDS = [
  // Language models
  'openai/gpt-6-astra', // OpenAI flagship
  'anthropic/claude-opus-5.5', // Best quality
  'google/gemini-4-carbon', // Google flagship
  // Image generation
  'openai/gpt-image-2.6-flare', // OpenAI image generation
  'google/gemini-nano-banana-2.1', // Multimodal image generation
];

// API response model structure from backend (camelCase, converted from Vercel AI Gateway snake_case)
export type IGatewayModelAPI = IGatewayApiModel;

export interface IGatewayModelsStepProps {
  gatewayModels: IGatewayModel[];
  onChange: (models: IGatewayModel[]) => void;
  disabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
}

export interface ITestState {
  testing: boolean;
  result?: 'success' | 'error';
  message?: string;
}
