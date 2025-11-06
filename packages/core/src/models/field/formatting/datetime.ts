import { formatInTimeZone } from 'date-fns-tz';
import dayjs from 'dayjs';
import { z } from '../../../zod';
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
  Hour12 = 'hh:mm A',
  None = 'None',
}

export const datetimeFormattingSchema = z
  .object({
    date: z.string().meta({
      description:
        'the display formatting of the date. you can use the following presets: ' +
        Object.values(DateFormattingPreset).join(', '),
    }),
    time: z.enum(TimeFormatting).meta({
      description:
        'the display formatting of the time. you can use the following presets: ' +
        Object.values(TimeFormatting).join(', '),
    }),
    timeZone: timeZoneStringSchema,
  })
  .describe(
    'Only be used in date field (date field or formula / rollup field with cellValueType equals dateTime)'
  )
  .meta({
    description:
      'caveat: the formatting is just a formatter, it dose not effect the storing value of the record',
  });

export type ITimeZoneString = string;

export type IDatetimeFormatting = z.infer<typeof datetimeFormattingSchema>;

export const defaultDatetimeFormatting: IDatetimeFormatting = {
  date: DateFormattingPreset.ISO,
  time: TimeFormatting.None,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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

  try {
    return dayjs(cellValue).tz(timeZone).format(format);
  } catch {
    // in export service case, crash in dayjs, so use date-fns-tz
    return formatInTimeZone(cellValue, timeZone, format.replace(/D/g, 'd').replace(/Y/g, 'y'));
  }
};

export const normalizeDateFormatting = (dateFormatting: string): string => {
  const validFormats = Object.values(DateFormattingPreset);
  if (validFormats.includes(dateFormatting as DateFormattingPreset)) {
    return dateFormatting;
  }
  return DateFormattingPreset.ISO;
};
