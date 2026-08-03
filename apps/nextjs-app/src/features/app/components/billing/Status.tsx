import { SubscriptionStatus } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

interface IStatusProps {
  status?: SubscriptionStatus;
}

export const Status = (props: IStatusProps) => {
  const { status = SubscriptionStatus.Active } = props;
  const { t } = useTranslation('common');

  const config = useMemo(() => {
    return {
      [SubscriptionStatus.Active]: {
        name: t('billing.status.active'),
        tagCls: 'bg-green-100 dark:bg-green-700 text-green-500 dark:text-white',
      },
      [SubscriptionStatus.Canceled]: {
        name: t('billing.status.canceled'),
        tagCls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-white',
      },
      [SubscriptionStatus.Incomplete]: {
        name: t('billing.status.incomplete'),
        tagCls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-white',
      },
      [SubscriptionStatus.IncompleteExpired]: {
        name: t('billing.status.incompleteExpired'),
        tagCls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-white',
      },
      [SubscriptionStatus.Trialing]: {
        name: t('billing.status.trialing'),
        tagCls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-white',
      },
      [SubscriptionStatus.PastDue]: {
        name: t('billing.status.pastDue'),
        tagCls: 'bg-red-100 dark:bg-red-700 text-red-500 dark:text-white',
      },
      [SubscriptionStatus.Unpaid]: {
        name: t('billing.status.unpaid'),
        tagCls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-white',
      },
      [SubscriptionStatus.Paused]: {
        name: t('billing.status.paused'),
        tagCls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-white',
      },
      [SubscriptionStatus.SeatLimitExceeded]: {
        name: t('billing.status.seatLimitExceeded'),
        tagCls: 'bg-red-100 dark:bg-red-700 text-red-500 dark:text-white',
      },
    };
  }, [t]);

  if (status === SubscriptionStatus.Active) {
    return null;
  }

  return (
    <div className={cn('shrink-0 rounded px-2 py-px text-[13px] text-', config[status].tagCls)}>
      {config[status].name}
    </div>
  );
};
