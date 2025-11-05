import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings, Trash2 } from '@teable/icons';
import type { OAuthGetListVo } from '@teable/openapi';
import { oauthGetList, oauthDelete } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button, Card, CardContent } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';

export const OAuthAppList = () => {
  const router = useRouter();
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  const queryClient = useQueryClient();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedApp, setSelectedApp] = useState<OAuthGetListVo[number] | null>(null);
  const { data: oauthApps } = useQuery({
    queryKey: ReactQueryKeys.oauthAppList(),
    queryFn: () => oauthGetList().then((data) => data.data),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const { mutate: deleteOAuthAppMutate, isLoading: deleteLoading } = useMutation({
    mutationFn: oauthDelete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.oauthAppList() });
      setShowDeleteModal(false);
      setSelectedApp(null);
    },
  });

  const getPreviewUrl = usePreviewUrl();

  useEffect(() => {
    if (!showDeleteModal) {
      setSelectedApp(null);
    }
  }, [showDeleteModal]);

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
              <div className="absolute right-2 top-2 flex items-center gap-2">
                <Button
                  className="h-5 p-0.5 text-destructive hover:text-destructive"
                  variant={'ghost'}
                  onClick={() => {
                    setSelectedApp(app);
                    setShowDeleteModal(true);
                  }}
                >
                  <Trash2 />
                </Button>
                <Button
                  className="h-5 p-0.5"
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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        title={t('oauth:deleteConfirm.title')}
        description={t('oauth:deleteConfirm.description', { name: selectedApp?.name })}
        confirmText={t('common:actions.confirm')}
        cancelText={t('common:actions.cancel')}
        confirmLoading={deleteLoading}
        onConfirm={() => {
          if (selectedApp) {
            deleteOAuthAppMutate(selectedApp.clientId);
          }
        }}
        onCancel={() => {
          setShowDeleteModal(false);
        }}
      />
    </div>
  );
};
