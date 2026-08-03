import { useMutation, useQuery } from '@tanstack/react-query';
import { ANONYMOUS_USER_ID, isAnonymous } from '@teable/core';
import { Lock } from '@teable/icons';
import { shareViewFormSubmit, userMe } from '@teable/openapi';
import { SessionProvider, ShareViewContext } from '@teable/sdk/context';
import { Button } from '@teable/ui-lib';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useContext, useMemo } from 'react';
import { FormPreviewer } from '@/features/app/blocks/view/form/components';
import { shareConfig } from '@/features/i18n/share.config';
import { FormViewBase } from './FormViewBase';

export const FormView = () => {
  const { shareId, shareMeta } = useContext(ShareViewContext);
  const { mutateAsync } = useMutation({
    mutationFn: shareViewFormSubmit,
  });
  const requireLogin = shareMeta?.submit?.requireLogin;
  const { t } = useTranslation(shareConfig.i18nNamespaces);
  const router = useRouter();
  const { embed } = router.query;
  // Check real auth state via API when requireLogin is enabled,
  // since SessionProvider in share view always uses ANONYMOUS_USER_ID
  const { data: authUser, isLoading: isAuthLoading } = useQuery({
    queryKey: ['share-form-auth'],
    queryFn: () => userMe().then((res) => res.data),
    enabled: !!requireLogin,
    retry: false,
  });

  const needLogin =
    requireLogin && !isAuthLoading && (!authUser || (authUser && isAnonymous(authUser.id)));

  const onSubmit = async (fields: Record<string, unknown>) => {
    await mutateAsync({ shareId, fields });
  };

  const handleLogin = () => {
    const loginUrl = `/auth/login?redirect=${encodeURIComponent(router.asPath)}`;
    if (embed) {
      window.open(loginUrl, '_blank');
    } else {
      router.push(loginUrl);
    }
  };

  const user = useMemo(() => {
    return {
      id: authUser?.id ?? ANONYMOUS_USER_ID,
      name: authUser?.name ?? ANONYMOUS_USER_ID,
      email: authUser?.email ?? '',
      notifyMeta: authUser?.notifyMeta ?? {},
      hasPassword: authUser?.hasPassword ?? false,
      isAdmin: authUser?.isAdmin ?? false,
    };
  }, [authUser]);

  return (
    <div className="relative flex size-full">
      <SessionProvider user={user} disabledApi>
        {embed ? (
          <FormViewBase submit={needLogin ? undefined : onSubmit} />
        ) : (
          <FormPreviewer submit={needLogin ? undefined : onSubmit} />
        )}
      </SessionProvider>
      {needLogin && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-lg border bg-background p-8 shadow-lg">
            <Lock className="size-10 text-muted-foreground" />
            <p className="text-center text-sm text-muted-foreground">
              {t('share:form.requireLoginTip')}
            </p>
            <Button onClick={handleLogin}>{t('share:form.login')}</Button>
          </div>
        </div>
      )}
    </div>
  );
};
