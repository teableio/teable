import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import { createSpace } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useSession } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { spaceConfig } from '@/features/i18n/space.config';
import { useSetting } from '../../hooks/useSetting';
import { useSpaceListOrdered } from './useSpaceListOrdered';

export const NoSpacesPlaceholder = () => {
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const queryClient = useQueryClient();
  const { user } = useSession();
  const { disallowSpaceCreation } = useSetting();
  const spaceList = useSpaceListOrdered();

  const { mutate: createSpaceMutator, isLoading: createSpaceLoading } = useMutation({
    mutationFn: createSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
    },
  });

  const handleCreateSpace = () => {
    const name = getUniqName(
      t('space:initialSpaceName', { name: user.name }),
      spaceList?.map((space) => space.name) || []
    );
    createSpaceMutator({ name });
  };

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <h3 className="mb-2 text-2xl font-semibold">
          {t('space:noSpaces.title', { userName: user.name })}
        </h3>

        <p className="mb-8 leading-relaxed text-muted-foreground">
          {t('space:noSpaces.description')}
        </p>

        {!disallowSpaceCreation && (
          <Button
            onClick={handleCreateSpace}
            disabled={createSpaceLoading}
            size="lg"
            className="mb-8 px-8"
          >
            {createSpaceLoading && <Spin />} {t('space:action.createSpace')}
          </Button>
        )}

        <div className="relative">
          <Image
            src="/images/layout/pointer.png"
            alt="no spaces"
            width={120}
            height={120}
            className="opacity-80 dark:invert"
          />
        </div>
      </div>
    </div>
  );
};
