import type { IDatetimeFormatting } from '@teable/core';
import { formatDateToString, normalizeDateFormatting, TimeFormatting } from '@teable/core';
import { fromZonedTime } from 'date-fns-tz';
import dayjs from 'dayjs';

export const formatDisplayValue = (value: string, formatting: IDatetimeFormatting) => {
  const normalizedFormatting = {
    ...formatting,
    date: normalizeDateFormatting(formatting.date),
  };
  return dayjs(value).isValid() ? formatDateToString(value, normalizedFormatting) : '';
};

export const convertZonedInputToUtc = (inputValue: string, formatting: IDatetimeFormatting) => {
  const { date: dateFormatting, time: timeFormatting, timeZone } = formatting;
  const isTimeNone = timeFormatting === TimeFormatting.None;
  const normalizedDateFormatting = normalizeDateFormatting(dateFormatting);
  const formats = isTimeNone
    ? [normalizedDateFormatting]
    : [`${normalizedDateFormatting} ${timeFormatting}`, normalizedDateFormatting];
  let curDate = dayjs(inputValue.trim(), formats);
  const isValid = curDate.isValid();

  if (!isValid) return null;

  if (isTimeNone) {
    const now = fromZonedTime(new Date(), timeZone);
    curDate = curDate
      .set('hour', now.getHours())
      .set('minute', now.getMinutes())
      .set('second', now.getSeconds());
  }

  const zonedDate = curDate.toDate();
  const utcDate = fromZonedTime(zonedDate, timeZone);

  return utcDate.toISOString();
};
