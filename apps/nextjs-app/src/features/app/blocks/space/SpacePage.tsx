import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSpace } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef, type FC } from 'react';
import { GUIDE_CREATE_SPACE } from '@/components/Guide';
import { spaceConfig } from '@/features/i18n/space.config';
import { useTemplateMonitor } from '../base/duplicate/useTemplateMonitor';
import { SpaceCard } from './SpaceCard';
import { useBaseList } from './useBaseList';
import { useSpaceListOrdered } from './useSpaceListOrdered';

export const SpacePage: FC = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  useTemplateMonitor();

  const orderedSpaceList = useSpaceListOrdered();

  const baseList = useBaseList();

  const { mutate: createSpaceMutator, isLoading } = useMutation({
    mutationFn: createSpace,
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      router.push({
        pathname: '/space/[spaceId]',
        query: {
          spaceId: data.data.id,
        },
      });
    },
  });

  return (
    <div ref={ref} className="flex h-screen flex-1 flex-col overflow-hidden py-8">
      <div className="flex items-center justify-between px-12">
        <h1 className="text-2xl font-semibold">{t('space:allSpaces')}</h1>
        <Button
          className={GUIDE_CREATE_SPACE}
          size={'sm'}
          disabled={isLoading}
          onClick={() => createSpaceMutator({})}
        >
          {isLoading && <Spin className="size-3" />}
          {t('space:action.createSpace')}
        </Button>
      </div>
      <div className="flex-1 space-y-8 overflow-y-auto px-8 pt-8 sm:px-12">
        {orderedSpaceList.map((space) => (
          <SpaceCard
            key={space.id}
            space={space}
            bases={baseList?.filter(({ spaceId }) => spaceId === space.id)}
          />
        ))}
      </div>
    </div>
  );
};
