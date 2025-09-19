import { useMutation } from '@tanstack/react-query';
import { getUniqName, hasPermission } from '@teable/core';
import { createBase } from '@teable/openapi';
import type { IGetSpaceVo } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { useBaseList } from './useBaseList';

interface INoBasesPlaceholderProps {
  space: IGetSpaceVo;
}

export const NoBasesPlaceholder: FC<INoBasesPlaceholderProps> = ({ space }) => {
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
    const name = getUniqName(t('common:noun.base'), bases?.map((base) => base.name) || []);
    createBaseMutator({ spaceId: space.id, name });
  };

  const canCreateBase = hasPermission(space.role, 'base|create');

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <h3 className="mb-2 text-2xl font-semibold">
          {t('space:noBases.title', { userName: user.name })}
        </h3>

        <p className="mb-8 leading-relaxed text-muted-foreground">
          {t('space:noBases.description')}
        </p>

        {canCreateBase && (
          <Button
            onClick={handleCreateBase}
            disabled={createBaseLoading}
            size="lg"
            className="mb-8 px-8"
          >
            {createBaseLoading && <Spin />} {t('space:action.createBase')}
          </Button>
        )}

        <div className="relative">
          <Image
            src="/images/layout/pointer.png"
            alt="no bases"
            width={120}
            height={120}
            className="opacity-80 dark:invert"
          />
        </div>
      </div>
    </div>
  );
};
