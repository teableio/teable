import { CellValueType } from '@teable/core';
import { useTranslation } from '../../../../context/app/i18n';

export const useOperatorI18nMap = (cellValueType?: CellValueType) => {
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

  return commonMap;
};
