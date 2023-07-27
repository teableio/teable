/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import React from 'react';
import type { IViewInstance } from '../../model';

export const ViewContext = React.createContext<{
  views: IViewInstance[];
}>(null!);
