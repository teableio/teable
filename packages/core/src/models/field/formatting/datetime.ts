import { z } from 'zod';

export enum DateFormattingPreset {
  US = 'M/D/YYYY',
  European = 'D/M/YYYY',
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
    const timeZone = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions()
      .timeZone;
    return timeZone === value;
  },
  {
    message: 'Invalid time zone string',
  }
);

export const datetimeFormattingDef = z.object({
  date: z.string(),
  time: z.nativeEnum(TimeFormatting),
  timeZone: timeZoneStringSchema,
});

export type IDatetimeFormatting = z.infer<typeof datetimeFormattingDef>;

export const defaultDatetimeFormatting: IDatetimeFormatting = {
  date: DateFormattingPreset.US,
  time: TimeFormatting.None,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};
