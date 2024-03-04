import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSpace, getBaseAll, getSpaceList } from '@teable/openapi';
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

export const SpacePage: FC = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  useTemplateMonitor();

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: getSpaceList,
  });
  const { data: baseList } = useQuery({
    queryKey: ['base-all'],
    queryFn: () => getBaseAll(),
  });

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
    <div ref={ref} className="flex h-screen w-full flex-col py-8">
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
        {spaceList?.data.map((space) => (
          <SpaceCard
            key={space.id}
            space={space}
            bases={baseList?.data.filter(({ spaceId }) => spaceId === space.id)}
          />
        ))}
      </div>
    </div>
  );
};
