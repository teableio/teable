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
        tagCls: 'bg-gray-900/10 dark:bg-white/10 text-gray-600 dark:text-white/80',
        upgradeTagCls:
          'border border-gray-900/10 dark:border-white/10 text-gray-600 dark:text-white',
      },
      [BillingProductLevel.Pro]: {
        name: t('level.pro'),
        description: t('billing.levelTips', { level: t('level.pro') }),
        tagCls: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
        upgradeTagCls: 'border border-emerald-200 dark:border-emerald-700 text-emerald-600',
      },
      [BillingProductLevel.Business]: {
        name: t('level.business'),
        description: t('billing.levelTips', { level: t('level.business') }),
        tagCls: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400',
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
