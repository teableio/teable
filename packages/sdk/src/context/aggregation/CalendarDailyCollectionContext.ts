import type { ICalendarDailyCollectionVo } from '@teable/openapi';
import React from 'react';

export const CalendarDailyCollectionContext =
  React.createContext<ICalendarDailyCollectionVo | null>(null);
