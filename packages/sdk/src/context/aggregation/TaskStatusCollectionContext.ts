import type { ITaskStatusCollectionVo } from '@teable/openapi';
import React from 'react';

export const TaskStatusCollectionContext = React.createContext<ITaskStatusCollectionVo | null>(
  null
);
