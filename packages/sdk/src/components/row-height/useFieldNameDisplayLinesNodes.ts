/* eslint-disable sonarjs/no-duplicate-string */
import { Line1, Line2, Line3 } from '@teable/icons';
import { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';

export const useFieldNameDisplayLinesNodes = () => {
  const { t } = useTranslation();

  return useMemo(
    () => [
      {
        label: t('fieldNameConfig.displayLines', { count: 1 }),
        value: 1,
        Icon: Line1,
      },
      {
        label: t('fieldNameConfig.displayLines', { count: 2 }),
        value: 2,
        Icon: Line2,
      },
      {
        label: t('fieldNameConfig.displayLines', { count: 3 }),
        value: 3,
        Icon: Line3,
      },
    ],
    [t]
  );
};
