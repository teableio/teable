/* eslint-disable jsx-a11y/no-autofocus */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { Edit } from '@teable/icons';
import { deleteSpace, getSpaceById, updateSpace } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button, Input } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import { useState } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';
import { SpaceSettingContainer } from '@/features/app/components/SpaceSettingContainer';
import { spaceConfig } from '@/features/i18n/space.config';

export const GeneralPage = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const spaceId = router.query.spaceId as string;
  const [isEditing, setIsEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const { data: space } = useQuery({
    queryKey: ReactQueryKeys.space(spaceId),
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1]).then((res) => res.data),
  });

  const { mutateAsync: updateSpaceMutator } = useMutation({
    mutationFn: updateSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.space(spaceId) });
    },
  });

  const { mutate: deleteSpaceMutator } = useMutation({
    mutationFn: deleteSpace,
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

  return (
    <>
      <SpaceSettingContainer
        title={t('space:spaceSetting.general')}
        description={
          space && hasPermission(space.role, 'space|delete')
            ? t('space:spaceSetting.generalDescription')
            : undefined
        }
      >
        {!!space && (
          <div className="flex flex-col gap-y-2 py-4">
            <div className="flex justify-between">
              <h2 className="mb-2 text-xl font-semibold">{t('common:noun.space')}</h2>
              <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(true)}>
                {t('actions.delete')}
              </Button>
            </div>
            <div className="flex h-8 items-center gap-x-1 text-sm">
              <span className="w-24 text-gray-500">{t('space:spaceSetting.spaceName')}</span>
              {isEditing ? (
                <Input
                  defaultValue={space.name}
                  onBlur={onBlur}
                  onKeyDown={onKeydown}
                  autoFocus
                  className="h-8"
                />
              ) : (
                <>
                  <span>{space.name}</span>
                  {hasPermission(space.role, 'space|update') && (
                    <Button variant="ghost" size="xs" onClick={() => setIsEditing(true)}>
                      <Edit className="size-4 cursor-pointer text-gray-500" />
                    </Button>
                  )}
                </>
              )}
            </div>
            <div className="flex h-8 items-center gap-x-1 text-sm">
              <span className="w-24 text-gray-500">{t('space:spaceSetting.spaceId')}</span>
              <span>{spaceId}</span>
              <CopyButton
                variant="ghost"
                text={spaceId}
                size="xs"
                iconClassName="size-4 text-gray-500"
              />
            </div>
          </div>
        )}
      </SpaceSettingContainer>

      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title={
          <Trans ns="space" i18nKey={'tip.delete'}>
            {space?.name}
          </Trans>
        }
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={() => space && deleteSpaceMutator(space.id)}
      />
    </>
  );
};
