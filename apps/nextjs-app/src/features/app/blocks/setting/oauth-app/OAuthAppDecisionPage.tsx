import { useQuery } from '@tanstack/react-query';
import type { AllActions } from '@teable/core';
import { ActionPrefix } from '@teable/core';
import {
  Hash,
  HelpCircle,
  PackageCheck,
  Sheet,
  Square,
  Table2,
  TeableNew,
  User,
} from '@teable/icons';
import { decisionInfoGet } from '@teable/openapi';
import { usePermissionActionsStatic, useSession } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Badge, Button, Card, Separator, cn } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';
import { BrandFooter } from '../../view/form/components/BrandFooter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IconMap: Partial<Record<ActionPrefix, React.JSXElementConstructor<any>>> = {
  [ActionPrefix.Table]: Table2,
  [ActionPrefix.Field]: Hash,
  [ActionPrefix.Record]: Square,
  [ActionPrefix.View]: Sheet,
  [ActionPrefix.Automation]: PackageCheck,
  [ActionPrefix.User]: User,
};

export const OAuthAppDecisionPage = () => {
  const router = useRouter();
  const { user } = useSession();
  const transactionId = router.query.transaction_id as string;
  const getPreviewUrl = usePreviewUrl();
  const { actionPrefixStaticMap, actionStaticMap } = usePermissionActionsStatic();
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  const { data } = useQuery({
    queryKey: ['oauth-app-decision-info', transactionId],
    queryFn: ({ queryKey }) => decisionInfoGet(queryKey[1]),
    enabled: !!transactionId,
    refetchOnWindowFocus: false,
  });

  const decisionInfo = data?.data;

  const scopeMap = useMemo(
    () =>
      (decisionInfo?.scopes || []).reduce(
        (acc, scope) => {
          if (!actionStaticMap) {
            return acc;
          }
          const prefix = scope.split('|')[0] as ActionPrefix;
          const scopeDesc = actionStaticMap[scope as AllActions].description;
          if (acc[prefix]) {
            acc[prefix].push(scopeDesc);
          } else {
            acc[prefix] = [scopeDesc];
          }
          return acc;
        },
        {} as Record<ActionPrefix, string[]>
      ),
    [actionStaticMap, decisionInfo?.scopes]
  );

  if (!transactionId) {
    return <div>Transaction ID is required</div>;
  }

  if (!decisionInfo) {
    return <Spin />;
  }

  const scopesLen = Object.keys(scopeMap).length;

  return (
    <div
      className={cn('h-screen w-full overflow-auto px-4', {
        'pt-8': scopesLen && scopesLen < 3,
      })}
    >
      <Card className="mx-auto my-8 min-w-72 max-w-xl space-y-4">
        <TeableNew className="ml-8 mt-3 size-8 text-black" />
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
        <div className="space-y-3 px-8">
          <div className="text-center">{t('oauth:decision.scopes')}</div>
          {Object.entries(scopeMap).map(([prefix, scopes]) => {
            const ScopeIcon = IconMap[prefix as ActionPrefix];
            return (
              <div key={prefix} className="space-y-2">
                <strong className="flex items-center gap-2 text-sm">
                  {ScopeIcon && <ScopeIcon />}
                  {actionPrefixStaticMap[prefix as ActionPrefix].title}
                </strong>
                <div className="flex flex-wrap gap-2">
                  {scopes.map((scope) => (
                    <Badge key={scope} variant={'outline'} className="text-xs font-normal">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
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
