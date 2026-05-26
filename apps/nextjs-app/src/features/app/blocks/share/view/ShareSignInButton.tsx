import { isAnonymous } from '@teable/core';
import { ShareViewContext } from '@teable/sdk/context';
import { useSession } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useContext } from 'react';
import { shareConfig } from '@/features/i18n/share.config';

/**
 * Inline "sign in to edit" hint shown next to the view name in each share
 * view's title bar. Only renders for anonymous viewers on an allowEdit share.
 * The whole amber pill is clickable; its color is the affordance.
 */
export const ShareSignInButton = () => {
  const { shareMeta } = useContext(ShareViewContext);
  const { user } = useSession();
  const { t } = useTranslation(shareConfig.i18nNamespaces);
  const router = useRouter();

  const visible = Boolean(shareMeta?.allowEdit) && isAnonymous(user?.id);
  if (!visible) return null;

  const handleSignIn = () => {
    const loginUrl = `/auth/login?redirect=${encodeURIComponent(router.asPath)}`;
    router.push(loginUrl);
  };

  // The i18n value still carries `<a>` markers for the "sign in" verb (kept in
  // case we later want to re-emphasize it); strip them here for plain rendering.
  const label = t('share:view.signInToEdit').replace(/<\/?a>/g, '');

  return (
    <button
      type="button"
      onClick={handleSignIn}
      className="inline-flex items-center rounded-md bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-200 dark:bg-orange-500/20 dark:text-orange-300 dark:hover:bg-orange-500/30"
    >
      {label}
    </button>
  );
};
