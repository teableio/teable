import { CellValueType, FieldType } from '@teable/core';
import { useTranslation } from '../../../../context/app/i18n';

export const useOperatorI18nMap = (cellValueType?: CellValueType, fieldType?: FieldType) => {
  const { t } = useTranslation();
  const commonMap = {
    is: t('filter.operator.is'),
    isNot: t('filter.operator.isNot'),
    contains: t('filter.operator.contains'),
    doesNotContain: t('filter.operator.doesNotContain'),
    isEmpty: t('filter.operator.isEmpty'),
    isNotEmpty: t('filter.operator.isNotEmpty'),
    isGreater: t('filter.operator.isGreater'),
    isGreaterEqual: t('filter.operator.isGreaterEqual'),
    isLess: t('filter.operator.isLess'),
    isLessEqual: t('filter.operator.isLessEqual'),
    isAnyOf: t('filter.operator.isAnyOf'),
    isNoneOf: t('filter.operator.isNoneOf'),
    hasAnyOf: t('filter.operator.hasAnyOf'),
    hasAllOf: t('filter.operator.hasAllOf'),
    hasNoneOf: t('filter.operator.hasNoneOf'),
    isExactly: t('filter.operator.isExactly'),
    isWithIn: t('filter.operator.isWithIn'),
    isBefore: t('filter.operator.isBefore'),
    isAfter: t('filter.operator.isAfter'),
    isOnOrBefore: t('filter.operator.isOnOrBefore'),
    isOnOrAfter: t('filter.operator.isOnOrAfter'),
    isNotExactly: t('filter.operator.isNot'),
  };
  if (cellValueType === CellValueType.Number) {
    return {
      ...commonMap,
      is: t('filter.operator.number.is'),
      isNot: t('filter.operator.number.isNot'),
      isGreater: t('filter.operator.number.isGreater'),
      isGreaterEqual: t('filter.operator.number.isGreaterEqual'),
      isLess: t('filter.operator.number.isLess'),
      isLessEqual: t('filter.operator.number.isLessEqual'),
    };
  }

  if (fieldType === FieldType.User) {
    // A user field filters on membership, so its menu is worded as
    // 是/不是/是任一/不是任一 (single user) and 包含任一/包含全部/完全等于/
    // 不完全等于/不包含任一 (multiple users) instead of the equality wording
    // the other string-valued fields use.
    return {
      ...commonMap,
      is: t('filter.operator.user.is'),
      isNot: t('filter.operator.user.isNot'),
      isAnyOf: t('filter.operator.user.isAnyOf'),
      isNoneOf: t('filter.operator.user.isNoneOf'),
      hasAnyOf: t('filter.operator.user.hasAnyOf'),
      hasAllOf: t('filter.operator.user.hasAllOf'),
      isExactly: t('filter.operator.user.isExactly'),
      isNotExactly: t('filter.operator.user.isNotExactly'),
      hasNoneOf: t('filter.operator.user.hasNoneOf'),
    };
  }

  return commonMap;
};
