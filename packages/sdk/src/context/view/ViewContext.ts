import React from 'react';
import type { View } from '../../model';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ViewContext = React.createContext<{
  views: View[];
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
}>(null!);
