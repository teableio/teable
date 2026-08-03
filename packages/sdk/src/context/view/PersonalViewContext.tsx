import type { IAggregationRo, IGetRecordsRo } from '@teable/openapi';
import { createContext } from 'react';

export const PersonalViewContext = createContext<{
  isPersonalView?: boolean;
  personalViewMap?: Record<string, unknown>;
  personalViewCommonQuery?: IGetRecordsRo;
  personalViewAggregationQuery?: IAggregationRo;
}>({});
