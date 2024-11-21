import type { IColorConfig } from '@teable/core';
import { ColorConfigType } from '@teable/core';
import { getColorPairs } from '@teable/sdk/components';
import type { Record, SingleSelectField } from '@teable/sdk/model';
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
