import type { IModelDefinationMap } from '@teable/openapi';
import { useMemo } from 'react';
import { isGatewayModelKey } from '../utils';
import type { IModelCategories, IModelOption } from './types';
import { checkIsImageModel, checkIsLanguageModel } from './utils';

interface IUseModelCategoriesOptions {
  options: IModelOption[];
  onlyImageOutput: boolean;
  modelDefinationMap?: IModelDefinationMap;
}

/**
 * Hook to categorize models into gateway, space, and instance options
 */
export function useModelCategories({
  options,
  onlyImageOutput,
  modelDefinationMap,
}: IUseModelCategoriesOptions): IModelCategories {
  return useMemo(() => {
    // Filter models based on field type context
    const filterByFieldType = (option: IModelOption): boolean => {
      // For attachment fields: show image models
      // For regular fields: show language models
      return onlyImageOutput
        ? checkIsImageModel(option, modelDefinationMap)
        : checkIsLanguageModel(option, modelDefinationMap);
    };

    return {
      // Gateway models (Recommended) - from AI Gateway
      gatewayOptions: options.filter((option) => {
        const { isGateway, modelKey } = option;
        if (!isGateway && !isGatewayModelKey(modelKey)) return false;
        return filterByFieldType(option);
      }),
      // Space models (Custom) - from space integration
      spaceOptions: options.filter((option) => {
        const { isInstance, modelKey, isGateway } = option;
        if (isInstance || isGateway || isGatewayModelKey(modelKey)) return false;
        return filterByFieldType(option);
      }),
      // Instance models (Legacy Provider) - from admin settings
      instanceOptions: options.filter((option) => {
        const { isInstance, modelKey, isGateway } = option;
        if (!isInstance || isGateway || isGatewayModelKey(modelKey)) return false;
        return filterByFieldType(option);
      }),
    };
  }, [options, onlyImageOutput, modelDefinationMap]);
}
