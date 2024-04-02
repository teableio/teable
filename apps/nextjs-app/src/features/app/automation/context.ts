import type { IWorkflowSection } from '@teable/core';
import React from 'react';

export interface IAutoMationContext {
  menuVisible: boolean;
  toggleMenu: (visible: boolean) => void;
  rightSiderVisible: boolean;
  setRightSiderVisible: (visible: boolean) => void;

  // menu data mack
  menuData: IWorkflowSection;
  setMenuData: React.Dispatch<IWorkflowSection>;
}

export const autoMationContext: React.Context<IAutoMationContext> =
  React.createContext<IAutoMationContext>(
    // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
    null!
  );
