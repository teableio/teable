import React from 'react';
import { IFieldInstance } from '../../model';

export const FieldContext = React.createContext<{
  fields: IFieldInstance[];
}>(null!);
