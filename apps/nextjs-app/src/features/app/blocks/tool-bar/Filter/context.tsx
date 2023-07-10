import type { IFilter } from '@teable-group/core';
import React from 'react';
import type { IFilterProps } from './types/types';

export interface IFilterContext {
  filters: IFilter;
  onChange: IFilterProps['onChange'];
  setFilters: (filter: IFilter) => void;
  addCondition: (filter: IFilter) => void;
  addConditionGroup: (filter: IFilter) => void;
}

export const FilterContext: React.Context<IFilterContext | null> =
  React.createContext<IFilterContext | null>(null);
