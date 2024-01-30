import type { IGroupPointsVo } from '@teable/core';
import React from 'react';

export const GroupPointContext = React.createContext<IGroupPointsVo | null>(null);
