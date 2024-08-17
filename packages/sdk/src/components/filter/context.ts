import React from 'react';
import type {
  IFilterBaseComponent,
  IFilterPath,
  IBaseFilterValue,
  IConditionItemProperty,
} from './types';

export interface IBaseFilterContext<T extends IConditionItemProperty = IConditionItemProperty> {
  maxDepth?: number;
  getValue: () => IBaseFilterValue;
  onDelete: (path: IFilterPath, index: number) => void;
  onChange: (path: IFilterPath, value: unknown) => void;
  createCondition: (path: IFilterPath, index: 'item' | 'group') => void;
  component: {
    FieldComponent: IFilterBaseComponent<T>;
    OperatorComponent: IFilterBaseComponent<T>;
    ValueComponent: IFilterBaseComponent<T>;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BaseFilterContext = React.createContext<IBaseFilterContext<any>>(
  // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
  null!
);
