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

// Whether nested popovers/selects inside the filter should render as Radix modal popovers.
// Set to true only when the filter is rendered inside a Dialog/Sheet so child selects can layer
// above the parent overlay. Defaults to false so the filter popover can stay non-blocking
// (no body pointer-events lock, no scroll lock) in toolbar/inline usages.
export const FilterModalContext: React.Context<boolean> = React.createContext<boolean>(false);
