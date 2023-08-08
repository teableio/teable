/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { IViewAggregateVo } from '@teable-group/core';
import React from 'react';

export const AggregateContext = React.createContext<{
  viewAggregate?: IViewAggregateVo;
}>(null!);
