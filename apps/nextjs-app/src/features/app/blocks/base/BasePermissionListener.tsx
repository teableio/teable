import { useQuery } from '@tanstack/react-query';
import { getBaseById } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, usePermissionUpdateListener, useSession } from '@teable/sdk/hooks';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useRef } from 'react';
import { baseConfig } from '@/features/i18n/base.config';

export const BasePermissionListener = () => {
  const baseId = useBaseId();
  const router = useRouter();
  const { t } = useTranslation(baseConfig.i18nNamespaces);
  const { user } = useSession();

  // Use ref to store the current active toast ID to prevent duplicates
  const activeToastIdRef = useRef<string | number | undefined>();

  const { data: base, refetch } = useQuery({
    queryKey: ReactQueryKeys.base(baseId!),
    queryFn: ({ queryKey }) => getBaseById(queryKey[1]).then((res) => res.data),
    enabled: !!baseId,
  });

  const restrictedAuthority = base?.restrictedAuthority;

  const onPermissionUpdate = useCallback(
    async (operatorUserId?: string) => {
      // Skip notification if the current user is the one who made the permission change
      if (operatorUserId === user?.id) {
        return;
      }

      const base = await refetch();
      if (
        !base.data?.restrictedAuthority &&
        Boolean(restrictedAuthority) !== Boolean(base.data?.restrictedAuthority)
      ) {
        return;
      }

      // Show toast notification instead of modal dialog
      // eslint-disable-next-line sonarjs/cognitive-complexity
      // Use the same ID to prevent duplicate notifications
      const toastId = toast.warning(t('common:pagePermissionChangeTip'), {
        id: activeToastIdRef.current,
        position: 'top-center',
        closeButton: true,
        duration: 500000,
        action: {
          label: t('common:actions.refreshPage'),
          onClick: () => router.reload(),
        },
        dismissible: true,
      });

      // Store the toast ID for future deduplication
      activeToastIdRef.current = toastId;
    },
    [user?.id, refetch, restrictedAuthority, t, router]
  );

  usePermissionUpdateListener(baseId, onPermissionUpdate);

  return null;
};
