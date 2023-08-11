/* eslint-disable @typescript-eslint/naming-convention */
import type { IViewAggregationVo } from '@teable-group/core';
import React from 'react';
export const AggregationContext = React.createContext<IViewAggregationVo | null>(null);
