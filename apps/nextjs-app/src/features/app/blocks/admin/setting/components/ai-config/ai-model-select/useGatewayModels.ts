import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IPickerModel } from '../GatewayModelPickerDialog';
import { parseModelKey, isGatewayModelKey } from '../utils';
import type { IGatewayModelAPI, IModelOption } from './types';

interface IUseGatewayModelsOptions {
  needGroup?: boolean;
  onlyImageOutput?: boolean;
  value?: string;
  options?: IModelOption[];
}

interface IUseGatewayModelsReturn {
  gatewayModels: IGatewayModelAPI[];
  isLoadingGateway: boolean;
  gatewayConfigured: boolean | null;
  pickerModels: IPickerModel[];
  selectedModelIdForPicker: string | undefined;
  fetchGatewayModels: () => Promise<void>;
  findGatewayModel: (value: string) => IModelOption | undefined;
}

/**
 * Hook to manage gateway models fetching and state
 */
export function useGatewayModels({
  needGroup,
  onlyImageOutput,
  value,
  options,
}: IUseGatewayModelsOptions): IUseGatewayModelsReturn {
  const [gatewayModels, setGatewayModels] = useState<IGatewayModelAPI[]>([]);
  const [isLoadingGateway, setIsLoadingGateway] = useState(false);
  const [gatewayConfigured, setGatewayConfigured] = useState<boolean | null>(null);

  // Fetch gateway models from backend API
  const fetchGatewayModels = useCallback(async () => {
    setIsLoadingGateway(true);
    try {
      const response = await fetch('/api/admin/setting/gateway-models');

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json();
      setGatewayConfigured(data.configured);
      setGatewayModels(data.models || []);
    } catch (error) {
      console.error('Failed to fetch gateway models:', error);
      setGatewayConfigured(false);
    } finally {
      setIsLoadingGateway(false);
    }
  }, []);

  // Pre-fetch gateway status on mount when needGroup is enabled
  useEffect(() => {
    if (needGroup && gatewayConfigured === null) {
      fetchGatewayModels();
    }
  }, [needGroup, gatewayConfigured, fetchGatewayModels]);

  // Transform gateway models to picker format and filter by type
  const pickerModels = useMemo((): IPickerModel[] => {
    // Filter by type based on context
    const filtered = gatewayModels.filter((m) => {
      if (onlyImageOutput) {
        // For attachment fields: show image type or models with image-generation tag
        return m.type === 'image' || m.tags?.includes('image-generation');
      } else {
        // For regular fields: show language type models only, exclude image-generation models
        return m.type === 'language' && !m.tags?.includes('image-generation');
      }
    });

    // Transform to IPickerModel format
    return filtered.map((m) => ({
      ...m,
      modelType: m.type,
    }));
  }, [gatewayModels, onlyImageOutput]);

  // Extract model ID from current value for picker selection state
  const selectedModelIdForPicker = useMemo(() => {
    if (value && isGatewayModelKey(value)) {
      const { model: modelId } = parseModelKey(value);
      return modelId;
    }
    return undefined;
  }, [value]);

  // Find gateway model from value if not in options
  const findGatewayModel = useCallback(
    (searchValue: string): IModelOption | undefined => {
      // First try to find in options
      const fromOptions = options?.find(
        ({ modelKey }) => modelKey.toLowerCase() === searchValue.toLowerCase()
      );
      if (fromOptions) return fromOptions;

      // If not found and value looks like a gateway model, check gatewayModels
      if (searchValue && isGatewayModelKey(searchValue)) {
        const { model: modelId } = parseModelKey(searchValue);
        const gatewayModel = gatewayModels.find((m) => m.id === modelId);
        if (gatewayModel) {
          return {
            modelKey: searchValue,
            label: gatewayModel.name,
            isGateway: true,
            tags: gatewayModel.tags,
            ownedBy: gatewayModel.ownedBy,
          } as IModelOption;
        }
      }

      return undefined;
    },
    [options, gatewayModels]
  );

  return {
    gatewayModels,
    isLoadingGateway,
    gatewayConfigured,
    pickerModels,
    selectedModelIdForPicker,
    fetchGatewayModels,
    findGatewayModel,
  };
}
