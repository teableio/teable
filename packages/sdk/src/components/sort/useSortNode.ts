import type { ISort } from '@teable/core';
import { ArrowUpDown } from '@teable/icons';
import { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';

export const useSortNode = (value?: ISort | null) => {
  const { t } = useTranslation();
  return useMemo(() => {
    const count = value?.sortObjs?.length;
    const text =
      !value?.manualSort && count
        ? t(`sort.displayLabel_${count > 1 ? 'other' : 'one'}`, { count })
        : t('sort.label');
    return {
      text,
      isActive: text !== t('sort.label'),
      Icon: ArrowUpDown,
    };
  }, [t, value?.manualSort, value?.sortObjs?.length]);
};
