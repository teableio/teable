/* eslint-disable jsx-a11y/no-autofocus */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { deleteSpace, getSpaceById, permanentDeleteSpace, updateSpace } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button, Input } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';
import { DeleteSpaceConfirm } from '@/features/app/components/space/DeleteSpaceConfirm';
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
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.space(spaceId) });
    },
  });

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

  return (
    <>
      <SpaceSettingContainer
        title={t('space:spaceSetting.general')}
        description={t('space:spaceSetting.generalDescription')}
      >
        {!!space && (
          <div className="flex h-full flex-col justify-between">
            <div className="flex flex-col gap-y-4">
              {/* Avatar */}
              <div className="flex size-14 items-center justify-center rounded-md border text-2xl font-medium">
                {space.name.charAt(0).toUpperCase()}
              </div>

              {/* Space name */}
              <div className="flex max-w-sm flex-col gap-y-1 overflow-visible">
                <label className="text-sm font-medium">{t('space:spaceSetting.spaceName')}</label>
                {isEditing ? (
                  <Input
                    defaultValue={space.name}
                    onBlur={onBlur}
                    onKeyDown={onKeydown}
                    autoFocus
                    className="h-9 px-3 shadow-none focus-visible:border-primary focus-visible:ring-0"
                  />
                ) : (
                  <Input
                    value={space.name}
                    readOnly
                    onClick={() => hasPermission(space.role, 'space|update') && setIsEditing(true)}
                    className={`h-9 px-3 shadow-none ${hasPermission(space.role, 'space|update') ? 'cursor-pointer' : 'cursor-default'}`}
                  />
                )}
              </div>

              {/* Space ID */}
              <div className="flex max-w-sm flex-col gap-y-1">
                <label className="text-sm font-medium">{t('space:spaceSetting.spaceId')}</label>
                <div className="relative">
                  <Input
                    value={spaceId}
                    readOnly
                    tabIndex={-1}
                    className="h-9 cursor-default px-3 pr-10 shadow-none focus-visible:ring-0 "
                  />
                  <CopyButton
                    variant="ghost"
                    text={spaceId}
                    size="xs"
                    iconClassName="size-4"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                  />
                </div>
              </div>
            </div>

            {/* Delete space button */}
            {hasPermission(space.role, 'space|delete') && (
              <Button
                variant="outline"
                className="w-fit text-destructive hover:text-destructive/80"
                onClick={() => setDeleteConfirm(true)}
              >
                {t('space:deleteSpaceModal.title')}
              </Button>
            )}
          </div>
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
