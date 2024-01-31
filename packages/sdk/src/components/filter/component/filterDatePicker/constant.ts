import { daysAgo, daysFromNow, exactDate, nextNumberOfDays, pastNumberOfDays } from '@teable/core';
import type {
  IDateTimeFieldSubOperator,
  IDateTimeFieldSubOperatorByIsWithin,
  ITimeZoneString,
} from '@teable/core';

const defaultMapping: Record<
  IDateTimeFieldSubOperator | IDateTimeFieldSubOperatorByIsWithin,
  string
> = {
  // common
  today: 'today',
  tomorrow: 'tomorrow',
  yesterday: 'yesterday',
  oneWeekAgo: 'one week ago',
  oneWeekFromNow: 'one week from now',
  oneMonthAgo: 'one month ago',
  oneMonthFromNow: 'one month from now',
  daysAgo: 'days ago',
  daysFromNow: 'days from now',
  exactDate: 'exact date',

  // within
  pastWeek: 'past week',
  pastMonth: 'past month',
  pastYear: 'past year',
  nextWeek: 'next week',
  nextMonth: 'next Month',
  nextYear: 'next Year',
  pastNumberOfDays: 'past numebr of days',
  nextNumberOfDays: 'next numebr of days',
};

const INPUTOPTIONS: string[] = [
  daysAgo.value,
  daysFromNow.value,
  pastNumberOfDays.value,
  nextNumberOfDays.value,
];

const DATEPICKEROPTIONS: string[] = [exactDate.value];

const defaultValue = {
  mode: exactDate.value,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
};

const withInDefaultValue = {
  mode: nextNumberOfDays.value,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
};

export { defaultMapping, DATEPICKEROPTIONS, INPUTOPTIONS, defaultValue, withInDefaultValue };
