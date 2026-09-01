import { isAnonymous } from '@teable/core';
import { ShareViewContext } from '@teable/sdk/context';
import { useSession } from '@teable/sdk/hooks';
import { Badge, Button } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useContext } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { MobileShareOperationBar } from '@/features/app/components/share-operation/MobileShareOperationBar';
import { useBrand } from '@/features/app/hooks/useBrand';
import { shareConfig } from '@/features/i18n/share.config';

const useShareViewSignIn = () => {
  const { shareId, shareMeta } = useContext(ShareViewContext);
  const { user } = useSession();
  const router = useRouter();
  const visible = Boolean(shareMeta?.allowEdit) && isAnonymous(user?.id);
  const handleSignIn = () => {
    router.push(`/auth/login?redirect=${encodeURIComponent(window.location.href)}`);
  };

  return { shareId, visible, handleSignIn };
};

export const ShareViewHeader = ({ viewName }: { viewName?: string }) => {
  const { t } = useTranslation(shareConfig.i18nNamespaces);
  const { visible, handleSignIn } = useShareViewSignIn();
  const { brandName } = useBrand();
  const editLabel = t('share:view.signInToEdit').replace(/<\/?a>/g, '');
  const authLabel = `${t('auth:button.signin')}/${t('auth:button.signup')}`;

  return (
    <div className="flex w-full items-center justify-between gap-3 px-1 py-2 md:px-0 md:py-3">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate font-semibold md:text-lg">{viewName}</h1>
        {visible && (
          <Badge className="hidden shrink-0 rounded-sm border-transparent bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-600 shadow-none hover:bg-amber-100 dark:bg-amber-500/20 dark:text-amber-300 hover:dark:bg-amber-500/20 min-[641px]:inline-flex">
            {editLabel}
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-6">
        {visible && (
          <Button
            type="button"
            size="sm"
            className="hidden whitespace-nowrap min-[641px]:inline-flex"
            onClick={handleSignIn}
          >
            {authLabel}
          </Button>
        )}
        <Link href="/" className="flex items-center">
          <TeableLogo className="md:text-2xl" />
          <p className="ms-1 font-semibold">{brandName}</p>
        </Link>
      </div>
    </div>
  );
};

export const ShareViewMobileSignIn = () => {
  const { shareId, visible, handleSignIn } = useShareViewSignIn();

  if (!visible) return null;

  return <MobileShareOperationBar key={shareId} operation="edit" onAction={handleSignIn} />;
};
