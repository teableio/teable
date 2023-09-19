import React from 'react';
import type { Base } from '../../model';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BaseContext = React.createContext<{
  base?: Base;
}>({});
