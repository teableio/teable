/* eslint-disable sonarjs/no-duplicate-string */
import { BillingProductLevel } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

export type AppSumoTier = 1 | 2 | 3 | 4;

export const useBillingLevelConfig = (productLevel?: BillingProductLevel) => {
  const { t } = useTranslation('common');

  const config = useMemo(() => {
    return {
      [BillingProductLevel.Free]: {
        name: t('level.free'),
        description: t('billing.levelTips', { level: t('level.free') }),
        tagCls: 'bg-gray-900/10 dark:bg-white/10 text-gray-600 dark:text-gray-300',
        upgradeTagCls:
          'border border-gray-900/10 dark:border-white/10 text-gray-600 dark:text-white',
      },
      [BillingProductLevel.Pro]: {
        name: t('level.pro'),
        description: t('billing.levelTips', { level: t('level.pro') }),
        tagCls: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
        upgradeTagCls: 'border border-emerald-200 dark:border-emerald-400 text-emerald-400',
      },
      [BillingProductLevel.Business]: {
        name: t('level.business'),
        description: t('billing.levelTips', { level: t('level.business') }),
        tagCls: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400',
        upgradeTagCls: 'border border-blue-200 dark:border-blue-400 text-blue-400',
      },
      [BillingProductLevel.Enterprise]: {
        name: t('level.enterprise'),
        description: t('billing.levelTips', { level: t('level.enterprise') }),
        tagCls: 'bg-primary text-primary-foreground',
        upgradeTagCls: 'border border-primary',
      },
    };
  }, [t]);

  return config[productLevel as BillingProductLevel] ?? config[BillingProductLevel.Free];
};

export const useAppSumoTierConfig = (tier?: AppSumoTier) => {
  const { t } = useTranslation('common');

  const config = useMemo(() => {
    return {
      1: {
        name: 'Diamond Tier 1',
        description: t('billing.levelTips', { level: 'Diamond Tier 1' }),
        tagCls: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
      },
      2: {
        name: 'Diamond Tier 2',
        description: t('billing.levelTips', { level: 'Diamond Tier 2' }),
        tagCls: 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400',
      },
      3: {
        name: 'Diamond Tier 3',
        description: t('billing.levelTips', { level: 'Diamond Tier 3' }),
        tagCls: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400',
      },
      4: {
        name: 'Diamond Tier 4',
        description: t('billing.levelTips', { level: 'Diamond Tier 4' }),
        tagCls: 'bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400',
      },
    };
  }, [t]);

  return tier ? config[tier] : null;
};
