import { z } from 'zod';
// The `Intl.DateTimeFormat` object in JavaScript can format dates according to different locales. Here's a list of common locales and the corresponding general date formats:

// | Locale | Date Format | Notes |
// |--------|-------------|-------|
// | en-US  | M/D/YYYY    | U.S. English (United States), e.g., 12/31/2023 |
// | en-GB  | D/M/YYYY    | British English (United Kingdom, European), e.g., 31/12/2023 |
// | fr-FR  | DD/MM/YYYY  | French (France), e.g., 31/12/2023 |
// | de-DE  | DD.MM.YYYY  | German (Germany), e.g., 31.12.2023 |
// | ja-JP  | YYYY/MM/DD  | Japanese (Japan), e.g., 2023/12/31 |
// | zh-CN  | YYYY-MM-DD  | Simplified Chinese (China), e.g., 2023-12-31 |
// | ko-KR  | YYYY.MM.DD  | Korean (South Korea), e.g., 2023.12.31 |

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
