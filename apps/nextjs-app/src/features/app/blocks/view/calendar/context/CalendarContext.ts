import type { IColorConfig } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import type { DateField, IFieldInstance, SingleSelectField } from '@teable/sdk/model';
import { createContext } from 'react';
import type { ICalendarPermission } from '../type';

export interface ICalendarContext {
  recordQuery?: Pick<IGetRecordsRo, 'filter' | 'orderBy'>;
  titleField?: IFieldInstance;
  startDateField?: DateField;
  endDateField?: DateField;
  colorField?: SingleSelectField;
  colorConfig?: IColorConfig;
  permission: ICalendarPermission;
  setExpandRecordId: (recordId?: string) => void;
  // the loaded records in display order, for the expanded record's prev / next
  setOrderedRecordIds: (recordIds: string[]) => void;
}

export const CalendarContext = createContext<ICalendarContext>(null!);
