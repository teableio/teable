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
        tagCls: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-white',
        upgradeTagCls: 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-white',
      },
      [BillingProductLevel.Plus]: {
        name: t('level.plus'),
        description: t('billing.levelTips', { level: t('level.plus') }),
        tagCls: 'bg-emerald-200 dark:bg-emerald-700 text-emerald-600 dark:text-white',
        upgradeTagCls: 'border border-emerald-200 dark:border-emerald-700 text-emerald-600',
      },
      [BillingProductLevel.Pro]: {
        name: t('level.pro'),
        description: t('billing.levelTips', { level: t('level.pro') }),
        tagCls: 'bg-blue-200 dark:bg-blue-700 text-blue-600 dark:text-white',
        upgradeTagCls: 'border border-blue-200 dark:border-blue-700 text-blue-600',
      },
      [BillingProductLevel.Enterprise]: {
        name: t('level.enterprise'),
        description: t('billing.levelTips', { level: t('level.enterprise') }),
        tagCls: 'bg-foreground text-background',
        upgradeTagCls: 'border border-foreground',
      },
    };
  }, [t]);

  return config[productLevel as BillingProductLevel] ?? config[BillingProductLevel.Free];
};
