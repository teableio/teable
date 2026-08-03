import type { ICalendarColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';
import type { ICalendarViewOptions } from './calendar-view-option.schema';

export interface ICalendarView extends IViewVo {
  type: ViewType.Calendar;
  options: ICalendarViewOptions;
}

export class CalendarViewCore extends ViewCore {
  type!: ViewType.Calendar;

  options!: ICalendarViewOptions;

  columnMeta!: ICalendarColumnMeta;
}
