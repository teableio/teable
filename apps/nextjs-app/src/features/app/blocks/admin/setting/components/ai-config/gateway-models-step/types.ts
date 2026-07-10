import type { IGatewayModel, IGatewayApiModel } from '@teable/openapi';

// Recommended model IDs - all details fetched from API
export const RECOMMENDED_MODEL_IDS = [
  // Language models
  'anthropic/claude-opus-4.6', // Best quality
  'openai/gpt-5.2-chat', // OpenAI flagship
  'google/gemini-3.1-pro-preview', // Google flagship
  // Image generation
  'google/gemini-3-pro-image', // Multimodal image generation
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
