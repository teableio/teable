import type { IDatetimeFormatting } from '@teable/core';
import { formatDateToString, normalizeDateFormatting } from '@teable/core';
import { fromZonedTime } from 'date-fns-tz';
import dayjs from 'dayjs';

export const formatDisplayValue = (value: string, formatting: IDatetimeFormatting) => {
  const normalizedFormatting = {
    ...formatting,
    date: normalizeDateFormatting(formatting.date),
  };
  return dayjs(value).isValid() ? formatDateToString(value, normalizedFormatting) : '';
};

export const convertZonedInputToUtc = (inputValue: string, timeZone: string) => {
  const curDate = dayjs(inputValue.trim());
  const isValid = curDate.isValid();

  if (!isValid) return null;

  const zonedDate = curDate.toDate();
  const utcDate = fromZonedTime(zonedDate, timeZone);

  return utcDate.toISOString();
};
