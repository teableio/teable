import React from 'react';

export interface IAutoMationContext {
  menuVisible: boolean;
  toggleMenu: (visible: boolean) => void;
  leftSiderVisible: boolean;
  setLeftSiderVisible: (visible: boolean) => void;
}

export const autoMationContext: React.Context<IAutoMationContext> =
  React.createContext<IAutoMationContext>(
    // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-non-null-assertion
    null!
  );
