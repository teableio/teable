import type { IGroupPointsVo } from '@teable-group/core';
import React from 'react';

export const GroupPointContext = React.createContext<IGroupPointsVo | null>(null);
