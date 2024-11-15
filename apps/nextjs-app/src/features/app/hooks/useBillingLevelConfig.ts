/* eslint-disable sonarjs/no-duplicate-string */
import { BillingProductLevel } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

export const useBillingLevelConfig = (productLevel?: BillingProductLevel) => {
  const { t } = useTranslation('common');

  const config = useMemo(() => {
    return {
      [BillingProductLevel.Free]: {
        name: t('level.free'),
        description: t('billing.levelTips', { level: t('level.free') }),
        tagCls: 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-white',
      },
      [BillingProductLevel.Plus]: {
        name: t('level.plus'),
        description: t('billing.levelTips', { level: t('level.plus') }),
        tagCls: 'bg-violet-200 dark:bg-violet-700 text-violet-600 dark:text-white',
      },
      [BillingProductLevel.Pro]: {
        name: t('level.pro'),
        description: t('billing.levelTips', { level: t('level.pro') }),
        tagCls: 'bg-amber-200 dark:bg-amber-700 text-amber-600 dark:text-white',
      },
      [BillingProductLevel.Enterprise]: {
        name: t('level.enterprise'),
        description: t('billing.levelTips', { level: t('level.enterprise') }),
        tagCls: 'bg-foreground text-background',
      },
    };
  }, [t]);

  return config[productLevel as BillingProductLevel] ?? config[BillingProductLevel.Free];
};
