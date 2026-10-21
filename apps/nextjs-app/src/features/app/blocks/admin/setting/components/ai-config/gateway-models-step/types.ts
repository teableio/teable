import type { IGatewayModel, IGatewayApiModel } from '@teable/openapi';

// Recommended model IDs - all details fetched from API
export const RECOMMENDED_MODEL_IDS = [
  // Language models
  'openai/gpt-6-astra', // OpenAI flagship
  'anthropic/claude-opus-4.8', // Best quality
  'google/gemini-3.8-flash', // Google flagship
  // Image generation
  'openai/gpt-image-2.5-flare', // OpenAI image generation
  'google/gemini-3.1-flash-image', // Multimodal image generation
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
