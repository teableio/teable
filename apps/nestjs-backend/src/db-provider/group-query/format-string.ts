import { DateFormattingPreset, TimeFormatting } from '@teable/core';

export const getPostgresDateTimeFormatString = (
  date: DateFormattingPreset,
  time: TimeFormatting
) => {
  switch (date) {
    case DateFormattingPreset.Y:
      return 'YYYY';
    case DateFormattingPreset.M:
    case DateFormattingPreset.YM:
      return 'YYYY-MM';
    default:
      return time !== TimeFormatting.None ? 'YYYY-MM-DD HH24:MI' : 'YYYY-MM-DD';
  }
};

export const getSqliteDateTimeFormatString = (date: DateFormattingPreset, time: TimeFormatting) => {
  switch (date) {
    case DateFormattingPreset.Y:
      return '%Y';
    case DateFormattingPreset.M:
    case DateFormattingPreset.YM:
      return '%Y-%m';
    default:
      return time !== TimeFormatting.None ? '%Y-%m-%d-%H-%M' : '%Y-%m-%d';
  }
};
