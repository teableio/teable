/* eslint-disable @typescript-eslint/naming-convention */
import type { IRawAggregationVo } from '@teable-group/core';
import React from 'react';
export const AggregationContext = React.createContext<IRawAggregationVo | null>(null);
