import {
  dateRange,
  daysAgo,
  daysFromNow,
  exactDate,
  exactDateTime,
  exactFormatDate,
  nextNumberOfDays,
  oneMonthAgo,
  oneMonthFromNow,
  oneWeekAgo,
  oneWeekFromNow,
  pastNumberOfDays,
} from '@teable/core';
import type { ITimeZoneString } from '@teable/core';

const INPUTOPTIONS: string[] = [
  daysAgo.value,
  daysFromNow.value,
  pastNumberOfDays.value,
  nextNumberOfDays.value,
];

const DATEPICKEROPTIONS: string[] = [exactDate.value, exactDateTime.value, exactFormatDate.value];

const DATERANGEOPTIONS: string[] = [dateRange.value];

const HIDDEN_DATE_MODES: string[] = [
  oneWeekAgo.value,
  oneWeekFromNow.value,
  oneMonthAgo.value,
  oneMonthFromNow.value,
  exactDateTime.value,
  exactFormatDate.value,
];

const defaultValue = {
  mode: exactDate.value,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
};

const withInDefaultValue = {
  mode: nextNumberOfDays.value,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
};

export {
  DATEPICKEROPTIONS,
  DATERANGEOPTIONS,
  INPUTOPTIONS,
  HIDDEN_DATE_MODES,
  defaultValue,
  withInDefaultValue,
};
