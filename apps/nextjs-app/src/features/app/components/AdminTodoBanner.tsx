import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, X } from '@teable/icons';
import { getSetting } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMeasure } from 'react-use';
import { useSecurityItems } from '@/features/app/blocks/admin/setting/components/ConfigurationList';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { TopBannerId, useTopBannerSlot } from '@/features/app/hooks/useTopBannerSlot';

const dismissedKey = (userId: string) => `teable:admin-todo-banner-dismissed:${userId}`;

const readDismissed = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * Points instance admins at the security group of the admin checklist from
 * the space and settings pages; on a fresh install that is right after the
 * first user signs up and becomes the admin. Dismissing hides it until the set
 * of risks changes. The admin pages show the checklist itself, so they do not
 * mount it.
 */
export const AdminTodoBanner = () => {
  const { t } = useTranslation('common');
  const { user } = useSession();
  const isCloud = useIsCloud();
  const shouldCheck = Boolean(user?.isAdmin && !isCloud);

  const { data: setting } = useQuery({
    queryKey: ['setting'],
    queryFn: () => getSetting().then(({ data }) => data),
    enabled: shouldCheck,
  });
  const securityItems = useSecurityItems(shouldCheck ? setting : undefined);
  const signature = securityItems
    .map((item) =>
      item.key === 'secrets'
        ? `secrets:${(setting?.insecureSecrets ?? []).map((s) => `${s.envKey}:${s.reason}`).join(',')}`
        : item.key
    )
    .join('|');

  const storageKey = user?.id ? dismissedKey(user.id) : undefined;
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    setDismissed(storageKey ? readDismissed(storageKey) : null);
  }, [storageKey]);

  const visible = securityItems.length > 0 && dismissed !== signature;

  const [bannerRef, { height }] = useMeasure<HTMLDivElement>();
  const { offset } = useTopBannerSlot({
    id: TopBannerId.AdminTodo,
    height,
    priority: 5,
    visible,
  });

  if (!visible || typeof document === 'undefined') return null;

  const dismiss = () => {
    try {
      if (storageKey) localStorage.setItem(storageKey, signature);
    } catch {
      // storage unavailable: hide for this page view only
    }
    setDismissed(signature);
  };

  return createPortal(
    // useMeasure reports the content box, so the padded row sits inside this wrapper.
    <div ref={bannerRef} style={{ top: offset }} className="fixed inset-x-0 z-50">
      <div className="flex items-center justify-center gap-2 bg-red-50 px-4 py-1.5 text-xs text-red-900 dark:bg-red-950/50 dark:text-red-200">
        <AlertTriangle className="size-3.5 shrink-0" />
        <span>{t('admin.configuration.banner.message')}</span>
        <Link href="/admin/setting">
          <Button size="xs" variant="outline" className="h-5 text-xs">
            {t('admin.configuration.banner.action')}
          </Button>
        </Link>
        <button
          type="button"
          aria-label={t('actions.close')}
          className="rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40"
          onClick={dismiss}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>,
    document.body
  );
};
