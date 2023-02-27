import { View } from '../../model';
import React from 'react';

export const ViewContext = React.createContext<{
  views: View[];
}>(null!);
