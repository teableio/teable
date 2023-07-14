const defaultMapping = {
  today: 'today',
  tomorrow: 'tomorrow',
  yesterdays: 'yesterdays',
  oneWeekAge: 'one week age',
  oneWeekFromNow: 'one week from now',
  oneMonthAge: 'one month age',
  oneMonthFromNow: 'one month from now',
  numberOfDaysAge: 'number of days age',
  numberOfDaysFromNow: 'number of days from now',
  exactDate: 'exact date',
};

const withinMapping = {
  pastWeek: 'the past week',
  pastMonth: 'the past month',
  pastYear: 'the past year',
  nextWeek: 'the next week',
  nextMonth: 'the next month',
  nextYear: 'the next year',
  nextNumberOfDays: 'the next number of days',
  pastNumberOfDays: 'the past number of days',
};

const INPUTOPTIONS = [
  'numberOfDaysAge',
  'numberOfDaysFromNow',
  'pastNumberOfDays',
  'nextNumberOfDays',
];

const DATEPICKEROPTIONS = ['exactDate'];

const defaultValue = {
  mode: 'exactDate',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

const withInDefaultValue = {
  mode: 'nextNumberOfDays',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export {
  defaultMapping,
  withinMapping,
  DATEPICKEROPTIONS,
  INPUTOPTIONS,
  defaultValue,
  withInDefaultValue,
};
