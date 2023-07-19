import type { IFilter } from '@teable-group/core';
import React from 'react';
import type { IFilterProps } from './types/types';

export interface IFilterContext {
  filters: IFilter | null;
  onChange: IFilterProps['onChange'];
  setFilters: (filter: IFilter | null) => void;
  addCondition: (filter: IFilter) => void;
  addConditionGroup: (filter: IFilter) => void;
}

export const FilterContext: React.Context<IFilterContext> = React.createContext<IFilterContext>(
  // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
  null!
);
