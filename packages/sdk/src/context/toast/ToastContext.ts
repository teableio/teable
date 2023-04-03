import React from 'react';

export interface IToastParams {
  title?: string | React.ReactNode;
  description?: string | React.ReactNode;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ToastContext = React.createContext<{
  open: (params: IToastParams | string) => void;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
}>(null!);
