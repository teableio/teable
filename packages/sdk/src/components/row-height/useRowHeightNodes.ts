import { RowHeightLevel } from '@teable/core';
import { RowExtralTall, RowMedium, RowTall, RowShort } from '@teable/icons';
import { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';

export const useRowHeightNodes = () => {
  const { t } = useTranslation();

  return useMemo(
    () => [
      {
        label: t('rowHeight.short'),
        value: RowHeightLevel.Short,
        Icon: RowShort,
      },
      {
        label: t('rowHeight.medium'),
        value: RowHeightLevel.Medium,
        Icon: RowMedium,
      },
      {
        label: t('rowHeight.tall'),
        value: RowHeightLevel.Tall,
        Icon: RowTall,
      },
      {
        label: t('rowHeight.extraTall'),
        value: RowHeightLevel.ExtraTall,
        Icon: RowExtralTall,
      },
    ],
    [t]
  );
};
