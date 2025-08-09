import { useQuery } from '@tanstack/react-query';
import { Plus, Settings } from '@teable/icons';
import { oauthGetList } from '@teable/openapi';
import { Button, Card, CardContent } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import { TeableLogo } from '@/components/TeableLogo';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';

export const OAuthAppList = () => {
  const router = useRouter();
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);

  const { data: oauthApps } = useQuery({
    queryKey: ['oauth-apps'],
    queryFn: () => oauthGetList().then((data) => data.data),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const getPreviewUrl = usePreviewUrl();

  return (
    <div>
      <div className="flex justify-between">
        <div className="text-sm font-normal text-muted-foreground">
          <Trans
            ns="oauth"
            i18nKey="title.description"
            components={{
              a: (
                <Link
                  href={t('oauth:help.link')}
                  className="text-violet-500 underline underline-offset-4"
                  target="_blank"
                />
              ),
            }}
          />
        </div>
        <Button
          size={'xs'}
          onClick={() => {
            router.push({ pathname: router.pathname, query: { form: 'new' } });
          }}
        >
          <Plus />
          {t('oauth:add')}
        </Button>
      </div>
      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3">
        {oauthApps?.map((app) => (
          <Card key={app.clientId} className="group shadow-none hover:shadow-md">
            <CardContent className="relative flex size-full items-center gap-5 px-2 py-3">
              <div className="relative size-16 overflow-hidden rounded-sm">
                {app.logo ? (
                  <Image
                    src={getPreviewUrl(app.logo)}
                    alt={app.name}
                    fill
                    sizes="100%"
                    style={{
                      objectFit: 'contain',
                    }}
                  />
                ) : (
                  <TeableLogo className="size-16" />
                )}
              </div>
              <div className="h-full flex-1 overflow-hidden">
                <div className="line-clamp-2 break-words text-sm">{app.name}</div>
                <div
                  className="line-clamp-3 break-words text-xs text-muted-foreground"
                  title={app.description}
                >
                  {app.description}
                </div>
              </div>
              <Button
                className="absolute right-2 top-2 h-5 p-0.5"
                variant={'ghost'}
                onClick={() => {
                  router.push({
                    pathname: router.pathname,
                    query: { form: 'edit', id: app.clientId },
                  });
                }}
              >
                <Settings />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
