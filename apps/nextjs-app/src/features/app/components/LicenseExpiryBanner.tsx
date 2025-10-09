import { useQuery } from '@tanstack/react-query';
import { getEnterpriseLicenseStatus } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useSession } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef } from 'react';
import { useIsEE } from '@/features/app/hooks/useIsEE';

export const LicenseExpiryBanner = () => {
  const { t } = useTranslation('common');
  const { user } = useSession();
  const isEE = useIsEE();
  const toastShownRef = useRef(false);

  const shouldCheck = Boolean(isEE && user?.isAdmin);

  const { data: licenseStatus } = useQuery({
    queryKey: ReactQueryKeys.getEnterpriseLicenseStatus(),
    queryFn: () => getEnterpriseLicenseStatus().then(({ data }) => data),
    enabled: shouldCheck,
  });

  const { expiredTime } = licenseStatus ?? {};

  useEffect(() => {
    if (!shouldCheck || !expiredTime || toastShownRef.current) return;

    toast.warning(
      <div className="flex w-full items-center justify-between gap-4">
        {t('billing.licenseExpiredGracePeriod', {
          expiredTime: new Date(expiredTime).toLocaleDateString(),
        })}
        <Link href="/admin/license" target="_blank">
          <Button>{t('actions.update')}</Button>
        </Link>
      </div>,
      {
        duration: Infinity,
        closeButton: true,
        position: 'top-center',
        className: 'sm:w-[672px] w-full',
      }
    );
    toastShownRef.current = true;
  }, [shouldCheck, expiredTime, t]);

  return null;
};
