import dayjs from 'dayjs';
import { z } from 'zod';
import { timeZoneStringSchema } from './time-zone';

export enum DateFormattingPreset {
  US = 'M/D/YYYY',
  European = 'D/M/YYYY',
  Asian = 'YYYY/MM/DD',
  ISO = 'YYYY-MM-DD',
  YM = 'YYYY-MM',
  MD = 'MM-DD',
  Y = 'YYYY',
  M = 'MM',
  D = 'DD',
}

export enum TimeFormatting {
  Hour24 = 'HH:mm',
  Hour12 = 'hh:mm',
  None = 'None',
}

export const datetimeFormattingSchema = z.object({
  date: z.string(),
  time: z.nativeEnum(TimeFormatting),
  timeZone: timeZoneStringSchema,
});

export type ITimeZoneString = z.infer<typeof timeZoneStringSchema>;

export type IDatetimeFormatting = z.infer<typeof datetimeFormattingSchema>;

export const defaultDatetimeFormatting: IDatetimeFormatting = {
  date: DateFormattingPreset.ISO,
  time: TimeFormatting.None,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
};

export const formatDateToString = (
  cellValue: string | undefined,
  formatting: IDatetimeFormatting
) => {
  if (cellValue == null) {
    return '';
  }

  const { date, time, timeZone } = formatting;
  const format = time === TimeFormatting.None ? date : `${date} ${time}`;
  return dayjs(cellValue as string)
    .tz(timeZone)
    .format(format);
};
