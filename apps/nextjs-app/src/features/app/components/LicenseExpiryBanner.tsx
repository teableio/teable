import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from '@teable/icons';
import { getEnterpriseLicenseStatus, retryEnterpriseLicenseAutoFetch } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useSession } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useIsEE } from '@/features/app/hooks/useIsEE';

const TOP_BANNER_HEIGHT = '28px';

export const LicenseExpiryBanner = () => {
  const { t } = useTranslation('common');
  const { user } = useSession();
  const isEE = useIsEE();
  const queryClient = useQueryClient();

  const shouldCheck = Boolean(isEE && user?.isAdmin);

  const { data: licenseStatus } = useQuery({
    queryKey: ReactQueryKeys.getEnterpriseLicenseStatus(),
    queryFn: () => getEnterpriseLicenseStatus().then(({ data }) => data),
    enabled: shouldCheck,
  });

  const { expiredTime, autoFetchEnabled, autoFetchFailed } = licenseStatus ?? {};

  const graceDaysRemaining = useMemo(() => {
    if (!expiredTime) return null;
    const remaining = new Date(expiredTime).getTime() - Date.now();
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  }, [expiredTime]);

  const showBanner = shouldCheck && !!expiredTime && graceDaysRemaining != null;
  const showAutoFetchFailed = autoFetchEnabled && autoFetchFailed;

  const { mutate: retryAutoFetch, isPending: isRetryingAutoFetch } = useMutation({
    mutationFn: retryEnterpriseLicenseAutoFetch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getEnterpriseLicenseStatus() });
      queryClient.invalidateQueries({ queryKey: ['enterprise-license'] });
    },
    onError: () => {
      toast.error(t('billing.licenseAutoFetchRetryFailed'));
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getEnterpriseLicenseStatus() });
    },
  });

  useEffect(() => {
    if (!showBanner) return;
    document.documentElement.style.setProperty('--teable-top-banner-height', TOP_BANNER_HEIGHT);
    document.body.dataset.teableTopBanner = 'visible';
    return () => {
      document.documentElement.style.removeProperty('--teable-top-banner-height');
      delete document.body.dataset.teableTopBanner;
    };
  }, [showBanner]);

  if (!showBanner || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
      <AlertTriangle className="size-3.5 shrink-0" />
      <span>
        {showAutoFetchFailed
          ? t('billing.licenseAutoFetchFailed', { days: graceDaysRemaining })
          : t('billing.licenseExpiredGracePeriodDays', { days: graceDaysRemaining })}
      </span>
      {showAutoFetchFailed ? (
        <Button
          size="xs"
          variant="outline"
          className="h-5 text-xs"
          disabled={isRetryingAutoFetch}
          onClick={() => retryAutoFetch()}
        >
          {isRetryingAutoFetch && <Loader2 className="mr-1 size-3 animate-spin" />}
          {t('actions.retry')}
        </Button>
      ) : (
        <Link href="/admin/license">
          <Button size="xs" variant="outline" className="h-5 text-xs">
            {t('actions.update')}
          </Button>
        </Link>
      )}
    </div>,
    document.body
  );
};
