import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings, Trash2 } from '@teable/icons';
import type { OAuthGetListVo } from '@teable/openapi';
import { oauthGetList, oauthDelete } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button, Card, CardContent } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';

interface IOAuthAppListProps {
  onEdit: (clientId: string) => void;
}

export const OAuthAppList = (props: IOAuthAppListProps) => {
  const { onEdit } = props;
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

  const { mutate: deleteOAuthAppMutate, isPending: deleteLoading } = useMutation({
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3">
        {oauthApps?.map((app) => (
          <Card key={app.clientId} className="group shadow-none hover:shadow-md">
            <CardContent className="relative flex size-full items-center gap-5 px-2 py-3">
              <div className="relative size-16 overflow-hidden rounded-sm">
                {app.logo ? (
                  <img
                    src={getPreviewUrl(app.logo)}
                    alt={app.name}
                    className="absolute inset-0 size-full object-contain"
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
                    onEdit(app.clientId);
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
