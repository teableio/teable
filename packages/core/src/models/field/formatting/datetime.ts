import dayjs from 'dayjs';
import { z } from 'zod';

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

// Define a Zod schema for time zone string
const timeZoneStringSchema = z.string().refine(
  (value) => {
    try {
      const timeZone = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions()
        .timeZone;
      return timeZone === value;
    } catch (e) {
      return false;
    }
  },
  {
    message: 'Invalid time zone string',
  }
);

export const datetimeFormattingSchema = z.object({
  date: z.string(),
  time: z.nativeEnum(TimeFormatting),
  timeZone: timeZoneStringSchema,
});

export type IDatetimeFormatting = z.infer<typeof datetimeFormattingSchema>;

export const defaultDatetimeFormatting: IDatetimeFormatting = {
  date: DateFormattingPreset.US,
  time: TimeFormatting.None,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export const formatDateToString = (cellValue: string, formatting: IDatetimeFormatting) => {
  if (cellValue == null) {
    return '';
  }

  const { date, time } = formatting;
  const format = time === TimeFormatting.None ? date : `${date} ${time}`;
  return dayjs(cellValue as string).format(format);
};
