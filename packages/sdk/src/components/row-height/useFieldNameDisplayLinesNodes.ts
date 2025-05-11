/* eslint-disable sonarjs/no-duplicate-string */
import { Menu, Square, StretchHorizontal } from '@teable/icons';
import { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';

export const useFieldNameDisplayLinesNodes = () => {
  const { t } = useTranslation();

  return useMemo(
    () => [
      {
        label: t('fieldNameConfig.displayLines', { count: 1 }),
        value: 1,
        Icon: Square,
      },
      {
        label: t('fieldNameConfig.displayLines', { count: 2 }),
        value: 2,
        Icon: StretchHorizontal,
      },
      {
        label: t('fieldNameConfig.displayLines', { count: 3 }),
        value: 3,
        Icon: Menu,
      },
    ],
    [t]
  );
};
