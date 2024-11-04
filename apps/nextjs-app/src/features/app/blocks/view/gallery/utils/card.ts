import { FieldType } from '@teable/core';
import type { IFieldInstance } from '@teable/sdk/model';

export const CARD_STYLE = {
  titleHeight: 32,
  cardPaddingBottom: 16,
  contentPadding: 8,
  itemGap: 8,
  itemInnerGap: 4,
  itemTitleHeight: 16,
};

export const DEFAULT_FIELD_HEIGHT = 20;

export const CARD_COVER_HEIGHT = 180;

export const LONG_TEXT_FIELD_DISPLAY_ROWS = 4;

export const FIELD_HEIGHT_MAP: { [key in FieldType]?: number } = {
  [FieldType.Attachment]: 28,
  [FieldType.SingleSelect]: 20,
  [FieldType.MultipleSelect]: 20,
  [FieldType.Link]: 20,
  [FieldType.User]: 24,
  [FieldType.CreatedBy]: 24,
  [FieldType.LastModifiedBy]: 24,
  [FieldType.Rating]: 16,
};

const { titleHeight, contentPadding, cardPaddingBottom, itemGap, itemInnerGap, itemTitleHeight } =
  CARD_STYLE;

export const getCardHeight = (
  fields: IFieldInstance[],
  hasCover?: boolean,
  isFieldNameHidden?: boolean
) => {
  const fieldCount = fields.length;
  const staticFieldNameSpace = isFieldNameHidden ? 0 : itemInnerGap + itemTitleHeight;
  let staticHeight =
    titleHeight +
    contentPadding * 2 +
    (itemGap + staticFieldNameSpace) * fieldCount +
    cardPaddingBottom;
  staticHeight = hasCover ? staticHeight + CARD_COVER_HEIGHT : staticHeight;
  const dynamicHeight = fields.reduce((prev, { type }) => {
    return prev + (FIELD_HEIGHT_MAP[type] || DEFAULT_FIELD_HEIGHT);
  }, 0);
  return staticHeight + dynamicHeight;
};
