import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSpace, getSubscriptionSummaryList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { keyBy } from 'lodash';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef, type FC, useMemo } from 'react';
import { GUIDE_CREATE_SPACE } from '@/components/Guide';
import { spaceConfig } from '@/features/i18n/space.config';
import { useIsCloud } from '../../hooks/useIsCloud';
import { useSetting } from '../../hooks/useSetting';
import { useTemplateMonitor } from '../base/duplicate/useTemplateMonitor';
import { useSpaceSubscriptionMonitor } from '../billing/useSpaceSubscriptionMonitor';
import { RecentlyBase } from './RecentlyBase';
import { SpaceCard } from './SpaceCard';
import { useBaseList } from './useBaseList';
import { useSpaceListOrdered } from './useSpaceListOrdered';

export const SpacePage: FC = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const isCloud = useIsCloud();
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  useTemplateMonitor();
  useSpaceSubscriptionMonitor();

  const orderedSpaceList = useSpaceListOrdered();

  const baseList = useBaseList();

  const { data: subscriptionList } = useQuery({
    queryKey: ReactQueryKeys.subscriptionSummaryList(),
    queryFn: () => getSubscriptionSummaryList().then((data) => data.data),
    enabled: isCloud,
  });

  const { disallowSpaceCreation, disallowSpaceInvitation } = useSetting();

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

  const subscriptionMap = useMemo(() => {
    if (subscriptionList == null) return {};
    return keyBy(subscriptionList, 'spaceId');
  }, [subscriptionList]);

  return (
    <div ref={ref} className="flex h-screen flex-1 flex-col overflow-hidden py-8">
      <div className="flex items-center justify-between px-12">
        <h1 className="text-2xl font-semibold">{t('space:allSpaces')}</h1>
        {!disallowSpaceCreation && (
          <Button
            className={GUIDE_CREATE_SPACE}
            size={'sm'}
            disabled={isLoading}
            onClick={() => createSpaceMutator({})}
          >
            {isLoading && <Spin className="size-3" />}
            {t('space:action.createSpace')}
          </Button>
        )}
      </div>
      <div className="flex-1 space-y-8 overflow-y-auto px-8 pt-8 sm:px-12">
        <RecentlyBase />
        {orderedSpaceList.map((space) => (
          <SpaceCard
            key={space.id}
            space={space}
            bases={baseList?.filter(({ spaceId }) => spaceId === space.id)}
            subscription={subscriptionMap[space.id]}
            disallowSpaceInvitation={disallowSpaceInvitation}
          />
        ))}
      </div>
    </div>
  );
};
