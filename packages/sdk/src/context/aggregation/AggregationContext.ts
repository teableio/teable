/* eslint-disable @typescript-eslint/naming-convention */
import type { IAggregationVo } from '@teable/openapi';
import React from 'react';

export const AggregationContext = React.createContext<IAggregationVo | null>(null);
