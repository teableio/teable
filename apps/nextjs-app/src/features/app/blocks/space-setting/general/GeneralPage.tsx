/* eslint-disable jsx-a11y/no-autofocus */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import {
  deleteSpace,
  getSpaceById,
  permanentDeleteSpace,
  updateSpace,
  updateSpaceAvatar,
  SPACE_NAME_MAX_LENGTH,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button, cn, Input } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';
import { SettingItem, SettingSection } from '@/features/app/components/setting/SettingSection';
import { DeleteSpaceConfirm } from '@/features/app/components/space/DeleteSpaceConfirm';
import { SpaceAvatar } from '@/features/app/components/space/SpaceAvatar';
import { SpaceSettingContainer } from '@/features/app/components/SpaceSettingContainer';
import { spaceConfig } from '@/features/i18n/space.config';

export const GeneralPage = ({ spaceId: spaceIdProp }: { spaceId?: string } = {}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const spaceId = (spaceIdProp ?? router.query.spaceId) as string;
  const [isEditing, setIsEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const { data: space } = useQuery({
    queryKey: ReactQueryKeys.space(spaceId),
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1]).then((res) => res.data),
    enabled: Boolean(spaceId),
  });

  const { mutateAsync: updateSpaceMutator } = useMutation({
    mutationFn: updateSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.space(spaceId) });
    },
  });

  const { mutate: updateSpaceAvatarMutator } = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return updateSpaceAvatar(spaceId, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.space(spaceId) });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
    },
  });

  const uploadAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    updateSpaceAvatarMutator(file);
    e.target.value = '';
  };

  const { mutate: deleteSpaceMutator } = useMutation({
    mutationFn: deleteSpace,
    onSuccess: () => {
      router.push('/space');
    },
  });

  const { mutate: permanentDeleteSpaceMutator } = useMutation({
    mutationFn: permanentDeleteSpace,
    onSuccess: () => {
      router.push('/space');
    },
  });

  const onBlur = async (e: React.FocusEvent<HTMLInputElement, Element>) => {
    const value = e.target.value;
    if (!value || value === space?.name) {
      return setIsEditing(false);
    }
    await updateSpaceMutator({
      spaceId,
      updateSpaceRo: { name: value },
    });
    setIsEditing(false);
  };

  const onKeydown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const value = e.currentTarget.value;
      if (!value || value === space?.name) {
        return setIsEditing(false);
      }
      await updateSpaceMutator({
        spaceId,
        updateSpaceRo: { name: value },
      });
      setIsEditing(false);
    }
  };

  const canUpdate = !!space && hasPermission(space.role, 'space|update');

  return (
    <>
      <SpaceSettingContainer
        title={t('space:spaceSetting.general')}
        description={t('space:spaceSetting.generalDescription')}
      >
        {!!space && (
          <>
            <SettingSection title={t('space:spaceSetting.profile')}>
              <SettingItem
                label={t('space:spaceSetting.icon')}
                description={t('space:spaceSetting.iconDescription')}
                inline
                action={
                  <>
                    <SpaceAvatar
                      name={space.name}
                      avatar={space.avatar}
                      className="size-10 rounded-md border text-lg"
                    />
                    {canUpdate && (
                      <>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={uploadAvatar}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => avatarInputRef.current?.click()}
                        >
                          {t('common:actions.change')}
                        </Button>
                      </>
                    )}
                  </>
                }
              />
              <SettingItem
                label={t('space:spaceSetting.spaceName')}
                description={t('space:spaceSetting.spaceNameDescription')}
                htmlFor="space-setting-name"
                action={
                  isEditing ? (
                    <Input
                      id="space-setting-name"
                      defaultValue={space.name}
                      maxLength={SPACE_NAME_MAX_LENGTH}
                      onBlur={onBlur}
                      onKeyDown={onKeydown}
                      autoFocus
                      className="w-full sm:w-64"
                    />
                  ) : (
                    <Input
                      id="space-setting-name"
                      value={space.name}
                      readOnly
                      onClick={() => canUpdate && setIsEditing(true)}
                      className={cn(
                        'w-full sm:w-64',
                        canUpdate ? 'cursor-pointer' : 'cursor-default'
                      )}
                    />
                  )
                }
              />
              <SettingItem
                label={t('space:spaceSetting.spaceId')}
                description={t('space:spaceSetting.spaceIdDescription')}
                action={
                  // Read-only: shown as text with a copy button, never as a field to click into
                  <>
                    <span className="select-all font-mono text-sm">{spaceId}</span>
                    <CopyButton variant="ghost" size="icon-sm" text={spaceId} />
                  </>
                }
              />
            </SettingSection>

            {hasPermission(space.role, 'space|delete') && (
              <SettingSection title={t('common:settings.dangerZone')} danger>
                <SettingItem
                  label={t('space:deleteSpaceModal.title')}
                  description={t('space:spaceSetting.deleteSpaceDescription')}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirm(true)}
                    >
                      {t('space:deleteSpaceModal.title')}
                    </Button>
                  }
                />
              </SettingSection>
            )}
          </>
        )}
      </SpaceSettingContainer>

      {space && (
        <DeleteSpaceConfirm
          open={deleteConfirm}
          onOpenChange={setDeleteConfirm}
          spaceId={space.id}
          spaceName={space.name}
          onConfirm={() => deleteSpaceMutator(space.id)}
          onPermanentConfirm={() => permanentDeleteSpaceMutator(space.id)}
        />
      )}
    </>
  );
};
