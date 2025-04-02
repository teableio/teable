import { useQuery } from '@tanstack/react-query';
import { HelpCircle } from '@teable/icons';
import { decisionInfoGet } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button, Card, Separator, cn } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { OAuthScope } from '@/features/app/components/oauth/OAuthScope';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';
import { BrandFooter } from '../../view/form/components/BrandFooter';

export const OAuthAppDecisionPage = () => {
  const router = useRouter();
  const { user } = useSession();
  const transactionId = router.query.transaction_id as string;
  const getPreviewUrl = usePreviewUrl();
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  const { data } = useQuery({
    queryKey: ['oauth-app-decision-info', transactionId],
    queryFn: ({ queryKey }) => decisionInfoGet(queryKey[1]).then((data) => data.data),
    enabled: !!transactionId,
    refetchOnWindowFocus: false,
  });

  const decisionInfo = data;

  const scopesTypeLen = useMemo(() => {
    if (!decisionInfo?.scopes) {
      return 0;
    }
    const types: string[] = [];
    decisionInfo.scopes.forEach((scope) => {
      const type = scope.split('|')[0];
      if (!types.includes(type)) {
        types.push(type);
      }
    });
    return types.length;
  }, [decisionInfo?.scopes]);

  if (!transactionId) {
    return <div>Transaction ID is required</div>;
  }

  if (!decisionInfo) {
    return <Spin />;
  }

  return (
    <div
      className={cn('h-screen w-full overflow-auto px-4', {
        'pt-8': scopesTypeLen && scopesTypeLen < 3,
      })}
    >
      <Card className="mx-auto my-8 min-w-72 max-w-xl space-y-4">
        <TeableLogo className="ml-8 mt-3 size-8" />
        <div className="relative mx-auto size-28 overflow-hidden">
          {decisionInfo.logo ? (
            <Image
              src={getPreviewUrl(decisionInfo.logo)}
              alt="card cover"
              fill
              sizes="100%"
              style={{
                objectFit: 'contain',
              }}
            />
          ) : (
            <HelpCircle className="size-28" />
          )}
        </div>
        <h2 className="mt-4 px-2 text-center text-2xl">
          {t('oauth:decision.title', { name: decisionInfo.name })}
          <div className="flex items-center justify-center gap-2">
            <UserAvatar user={user} />
            <div className="text-sm text-muted-foreground">@{user?.name}</div>
          </div>
        </h2>

        <Separator />
        <OAuthScope scopes={decisionInfo.scopes} description={t('oauth:decision.scopes')} />
        <div className="space-y-4 border-t p-8">
          <form action="/api/oauth/decision" className="flex items-center gap-4" method="post">
            <input name="transaction_id" type="hidden" value={transactionId} />
            <Button
              type="submit"
              value={'Deny'}
              name="cancel"
              className="flex-1"
              size={'xs'}
              variant={'outline'}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" value={'Allow'} className="flex-1" size={'xs'}>
              {t('oauth:decision.authorize')}
            </Button>
          </form>
          <div className="text-center">
            <p className="text-sm">{t('oauth:decision.redirectDescription')}</p>
            <Button variant={'link'}>
              <Link target="_blank" href={decisionInfo.homepage}>
                {decisionInfo.homepage}
              </Link>
            </Button>
          </div>
        </div>
      </Card>
      <BrandFooter />
    </div>
  );
};
