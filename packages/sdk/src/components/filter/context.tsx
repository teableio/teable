import type { IFilterItem } from '@teable/core';
import React from 'react';
import type { IFilterProps, IFiltersPath, ConditionAddType } from './types';

export interface IFilterContext {
  onChange: IFilterProps['onChange'];
  setFilters: (path: IFiltersPath, value: IFilterItem['value'] | null) => void;
  addCondition: (path: IFiltersPath, type?: ConditionAddType) => void;
  deleteCondition: (path: IFiltersPath, index: number) => void;
}

export const FilterContext: React.Context<IFilterContext> = React.createContext<IFilterContext>(
  // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
  null!
);
