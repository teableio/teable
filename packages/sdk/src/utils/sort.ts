import { FieldType } from '@teable/core';
import type { IFieldVo, IGroup, ISort } from '@teable/core';

type IPinyinSortableField = Pick<
  IFieldVo,
  'type' | 'isLookup' | 'isConditionalLookup' | 'isMultipleCellValue'
>;

export const supportsPinyinSort = (field?: IPinyinSortableField) =>
  Boolean(
    field &&
    !field.isLookup &&
    !field.isConditionalLookup &&
    !field.isMultipleCellValue &&
    (field.type === FieldType.SingleLineText ||
      field.type === FieldType.LongText ||
      field.type === FieldType.Link)
  );

export const findPinyinSortGroupConflict = (sort?: ISort | null, group?: IGroup | null) => {
  if (sort?.manualSort === true) return;
  return sort?.sortObjs.find(
    (sortItem) =>
      sortItem.collation === 'zh-pinyin' &&
      group?.some((groupItem) => groupItem.fieldId === sortItem.fieldId)
  );
};

export const removePinyinSortGroupConflicts = (
  sort?: ISort | null,
  group?: IGroup | null
): ISort | null | undefined => {
  if (!sort || !findPinyinSortGroupConflict(sort, group)) return sort;

  return {
    ...sort,
    sortObjs: sort.sortObjs.map((sortItem) => {
      if (
        sortItem.collation !== 'zh-pinyin' ||
        !group?.some((groupItem) => groupItem.fieldId === sortItem.fieldId)
      ) {
        return sortItem;
      }
      const { collation: _collation, ...sortWithoutCollation } = sortItem;
      return sortWithoutCollation;
    }),
  };
};
