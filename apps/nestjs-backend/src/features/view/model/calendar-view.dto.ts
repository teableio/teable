import type { IShareViewMeta } from '@teable/core';
import { CalendarViewCore } from '@teable/core';

export class CalendarViewDto extends CalendarViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}
