import { ViewCore } from '@teable-group/core';
import React from 'react';

export const ViewContext = React.createContext<{
  views: ViewCore[];
}>(null!);
