import type { IFilterItem } from '@teable-group/core';
import React from 'react';
import type { IFilterProps, ConditionAddType } from './types';

export interface IFilterContext {
  onChange: IFilterProps['onChange'];
  setFilters: (path: string[], value: IFilterItem['value'] | null) => void;
  addCondition: (path: string[], type?: ConditionAddType) => void;
  deleteCondition: (path: string[], index: number) => void;
}

export const FilterContext: React.Context<IFilterContext> = React.createContext<IFilterContext>(
  // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
  null!
);
