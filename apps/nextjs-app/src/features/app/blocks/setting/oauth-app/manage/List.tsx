import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Settings, Trash2 } from '@teable/icons';
import type { OAuthGetListVo } from '@teable/openapi';
import { oauthGetList, oauthDelete } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import {
  SettingEmpty,
  SettingItemIcon,
  SettingListItem,
  SettingSection,
} from '@/features/app/components/setting/SettingSection';
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
      {oauthApps && !oauthApps.length ? (
        <SettingEmpty icon={<Settings />}>{t('oauth:empty')}</SettingEmpty>
      ) : (
        <SettingSection variant="list">
          {oauthApps?.map((app) => (
            <SettingListItem
              key={app.clientId}
              onClick={() => onEdit(app.clientId)}
              media={
                <SettingItemIcon className="relative">
                  {app.logo ? (
                    <img
                      src={getPreviewUrl(app.logo)}
                      alt={app.name}
                      className="absolute inset-0 size-full object-contain"
                    />
                  ) : (
                    <TeableLogo className="size-6" />
                  )}
                </SettingItemIcon>
              }
              title={<span className="truncate">{app.name}</span>}
              description={
                app.description ? (
                  <span className="line-clamp-2 break-words" title={app.description}>
                    {app.description}
                  </span>
                ) : undefined
              }
              meta={<span className="truncate">{app.homepage}</span>}
              actions={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={t('common:actions.more')}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(app.clientId)}>
                      <Pencil className="size-4" />
                      {t('common:actions.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        setSelectedApp(app);
                        setShowDeleteModal(true);
                      }}
                    >
                      <Trash2 className="size-4" />
                      {t('common:actions.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
          ))}
        </SettingSection>
      )}
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
