import type { IGroupPointsVo } from '@teable/openapi';
import React from 'react';

export const GroupPointContext = React.createContext<IGroupPointsVo | null>(null);
