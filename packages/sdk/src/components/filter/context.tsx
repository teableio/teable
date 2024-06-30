import type { IFilterItem } from '@teable/core';
import React from 'react';
import type { IFieldInstance } from '../../model';
import type {
  IFilterProps,
  IFiltersPath,
  ConditionAddType,
  IFilterComponents,
  IFilterContextMap,
} from './types';

export interface IFilterContext {
  fields: IFieldInstance[];
  components?: IFilterComponents;
  context?: IFilterContextMap;
  onChange: IFilterProps['onChange'];
  setFilters: (path: IFiltersPath, value: IFilterItem['value'] | null) => void;
  addCondition: (path: IFiltersPath, type?: ConditionAddType) => void;
  deleteCondition: (path: IFiltersPath, index: number) => void;
}

export interface IFilterDisplayContext {
  compact?: boolean;
}

export const FilterContext: React.Context<IFilterContext> = React.createContext<IFilterContext>(
  // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
  null!
);

export const FilterDisplayContext: React.Context<IFilterDisplayContext> =
  React.createContext<IFilterDisplayContext>({});
