import {
  daysAgo,
  daysFromNow,
  exactDate,
  exactFormatDate,
  nextNumberOfDays,
  pastNumberOfDays,
} from '@teable/core';
import type { ITimeZoneString } from '@teable/core';

const INPUTOPTIONS: string[] = [
  daysAgo.value,
  daysFromNow.value,
  pastNumberOfDays.value,
  nextNumberOfDays.value,
];

const DATEPICKEROPTIONS: string[] = [exactDate.value, exactFormatDate.value];

const defaultValue = {
  mode: exactDate.value,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
};

const withInDefaultValue = {
  mode: nextNumberOfDays.value,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
};

export { DATEPICKEROPTIONS, INPUTOPTIONS, defaultValue, withInDefaultValue };
