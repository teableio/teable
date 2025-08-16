import { useMutation } from '@tanstack/react-query';
import { getUniqName, hasPermission } from '@teable/core';
import { createBase } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import type { IGetSpaceVo } from '@teable/openapi';
import { spaceConfig } from '@/features/i18n/space.config';
import { useBaseList } from './useBaseList';
import { Spin } from '@teable/ui-lib/base';

interface IEmptySpacePlaceholderProps {
  space: IGetSpaceVo;
}

export const EmptySpacePlaceholder: FC<IEmptySpacePlaceholderProps> = ({ space }) => {
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { user } = useSession();
  const router = useRouter();
  const allBases = useBaseList();
  const bases = allBases?.filter((base) => base.spaceId === space.id);

  const { mutate: createBaseMutator, isLoading: createBaseLoading } = useMutation({
    mutationFn: createBase,
    onSuccess: ({ data }) => {
      router.push({
        pathname: '/base/[baseId]',
        query: { baseId: data.id },
      });
    },
  });

  const handleCreateBase = () => {
    const name = getUniqName(
      t('common:noun.base'),
      bases?.map((base) => base.name) || []
    );
    createBaseMutator({ spaceId: space.id, name });
  };

  const canCreateBase = hasPermission(space.role, 'base|create');

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-8">
      <div className="flex flex-col items-center text-center max-w-md">
        <h3 className="text-2xl font-semibold mb-2">
          {t('space:emptySpace.title', { userName: user.name })}
        </h3>
        
        <p className="text-muted-foreground mb-8 leading-relaxed">
          {t('space:emptySpace.description')}
        </p>

        {canCreateBase && (
          <Button 
            onClick={handleCreateBase}
            disabled={createBaseLoading}
            size="lg"
            className="px-8 mb-8"
          >
            {createBaseLoading && <Spin />} {t('space:action.createBase')}
          </Button>
        )}

        <div className="relative">
          <Image
            src="/images/layout/pointer.png"
            alt="Empty workspace"
            width={120}
            height={120}
            className="opacity-80 dark:invert"
          />
        </div>
      </div>
    </div>
  );
};
