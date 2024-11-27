import type { IColorConfig } from '@teable/core';
import { ColorConfigType, TimeFormatting } from '@teable/core';
import { getColorPairs } from '@teable/sdk/components';
import type { DateField, Record, SingleSelectField } from '@teable/sdk/model';
import { formatInTimeZone } from 'date-fns-tz';
import { DEFAULT_COLOR } from './components/CalendarConfig';

export const getColorByConfig = (
  record: Record,
  colorConfig: IColorConfig,
  colorField?: SingleSelectField
) => {
  const { type: colorType, fieldId: colorFieldId, color } = colorConfig ?? {};

  if (colorType === ColorConfigType.Field) {
    if (colorFieldId && colorField) {
      const colorFieldValue = record.fields[colorFieldId];
      const { color, backgroundColor } =
        colorField.displayChoiceMap[colorFieldValue as string] ?? {};
      return color && backgroundColor ? { color, backgroundColor } : getColorPairs(DEFAULT_COLOR);
    }
    return getColorPairs(DEFAULT_COLOR);
  }
  return getColorPairs(color ?? DEFAULT_COLOR);
};

export const getEventTitle = (title: string, startDate: string | null, dateField: DateField) => {
  const { time, timeZone } = dateField.options.formatting;
  const includeTime = time !== TimeFormatting.None;
  const timeStr = time === TimeFormatting.Hour24 ? time : 'hh:mm a';
  const prefixStr =
    includeTime && startDate
      ? `${formatInTimeZone(new Date(startDate as string), timeZone, timeStr)} `
      : '';

  return `${prefixStr}${title}`;
};
