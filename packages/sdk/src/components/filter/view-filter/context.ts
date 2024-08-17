import React from 'react';
import type { IFieldInstance } from '../../../model';
import type { IViewFilterLinkContext } from './types';

export interface IViewFilterContext {
  fields: IFieldInstance[];
  viewFilterLinkContext: IViewFilterLinkContext;
}

export const ViewFilterContext: React.Context<IViewFilterContext> =
  React.createContext<IViewFilterContext>(
    // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
    null!
  );
