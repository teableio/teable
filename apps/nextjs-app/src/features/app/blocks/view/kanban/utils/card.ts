import { FieldType } from '@teable/core';
import type { IFieldInstance, Record as IRecord } from '@teable/sdk/model';
import { UNCATEGORIZED_STACK_ID } from '../constant';
import type { IStackData } from '../type';

export const CARD_STYLE = {
  titleHeight: 24,
  padding: 12,
  gap: 12,
  itemGap: 8,
  itemInnerGap: 4,
  itemTitleHeight: 16,
};

export const DEFAULT_FIELD_HEIGHT = 20;

export const CARD_COVER_HEIGHT = 160;

export const LONG_TEXT_FIELD_DISPLAY_ROWS = 4;

export const FIELD_HEIGHT_MAP: { [key in FieldType]?: number } = {
  [FieldType.Attachment]: 28,
  [FieldType.SingleSelect]: 24,
  [FieldType.MultipleSelect]: 24,
  [FieldType.Link]: 24,
  [FieldType.User]: 24,
  [FieldType.CreatedBy]: 24,
  [FieldType.LastModifiedBy]: 24,
  [FieldType.Rating]: 16,
};

const { titleHeight, padding, gap, itemGap, itemInnerGap, itemTitleHeight } = CARD_STYLE;

export const getCardHeight = (
  record: IRecord,
  fields: IFieldInstance[],
  hasCover?: boolean,
  isFieldNameHidden?: boolean
) => {
  const validFields = fields.filter(({ id }) => {
    const cellValue = record.getCellValue(id);
    return cellValue != null;
  });
  const validLength = validFields.length;
  const staticFieldNameSpace = isFieldNameHidden ? 0 : itemInnerGap + itemTitleHeight;
  let staticHeight =
    titleHeight + padding * 2 + (itemGap + staticFieldNameSpace) * validLength + gap;
  staticHeight = hasCover ? staticHeight + CARD_COVER_HEIGHT + itemGap : staticHeight;
  const dynamicHeight = validFields.reduce((prev, { type }) => {
    if (type === FieldType.LongText) {
      return prev + DEFAULT_FIELD_HEIGHT * LONG_TEXT_FIELD_DISPLAY_ROWS;
    }
    return prev + (FIELD_HEIGHT_MAP[type] || DEFAULT_FIELD_HEIGHT);
  }, 0);
  return staticHeight + dynamicHeight;
};

export const getCellValueByStack = (stack: IStackData) => {
  const { id, data } = stack;

  if (id === UNCATEGORIZED_STACK_ID) {
    return null;
  }

  return data;
};
