import type {
  IModelDefinationMap,
  GatewayModelType,
  GatewayModelTag,
  GatewayModelProvider,
} from '@teable/openapi';
import type { ReactNode } from 'react';

// API response model structure from backend (camelCase)
export interface IGatewayModelAPI {
  id: string;
  created?: number;
  ownedBy?: GatewayModelProvider;
  name?: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
  type?: GatewayModelType;
  tags?: GatewayModelTag[];
  pricing?: Record<string, string>; // Pricing from Vercel AI Gateway (input, output, image, etc.)
}

export interface IModelOption {
  isInstance?: boolean;
  modelKey: string;
  isImageModel?: boolean; // User-configured image model flag from admin panel
  label?: string; // Display label for gateway models
  capabilities?: Record<string, unknown>; // Model capabilities
  isGateway?: boolean; // Is this a gateway model
  pricing?: {
    input?: string;
    output?: string;
    image?: string;
  }; // Pricing format (USD per token/image)
  // API metadata for enhanced display and functionality
  ownedBy?: GatewayModelProvider; // Provider (e.g., "anthropic", "google", "openai")
  modelType?: GatewayModelType; // Model type (e.g., "language", "image")
  tags?: GatewayModelTag[]; // Capability tags (e.g., ["image-generation", "vision", "tool-use"])
  contextWindow?: number; // Context window size
  maxTokens?: number; // Maximum output tokens
  description?: string; // Model description
}

export interface IAIModelSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  size?: 'xs' | 'sm' | 'lg' | 'default' | null | undefined;
  className?: string;
  options?: IModelOption[];
  disabled?: boolean;
  needGroup?: boolean;
  modelDefinationMap?: IModelDefinationMap;
  children?: ReactNode;
  onlyImageOutput?: boolean; // if true, only show image output models
}

// Categorized model options
export interface IModelCategories {
  gatewayOptions: IModelOption[];
  spaceOptions: IModelOption[];
  instanceOptions: IModelOption[];
}
