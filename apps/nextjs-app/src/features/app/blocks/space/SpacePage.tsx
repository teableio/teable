import { useQuery } from '@tanstack/react-query';
import { getSubscriptionSummaryList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsHydrated } from '@teable/sdk/hooks';
import { keyBy } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useRef, type FC, useMemo } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { useIsCloud } from '../../hooks/useIsCloud';
import { useSetting } from '../../hooks/useSetting';
import { useTemplateMonitor } from '../base/duplicate/useTemplateMonitor';
import { useSpaceSubscriptionMonitor } from '../billing/useSpaceSubscriptionMonitor';
import { FreshSettingGuideDialog } from './FreshSettingGuideDialog';
import { NoBasesPlaceholder } from './NoBasesPlaceholder';
import { NoSpacesPlaceholder } from './NoSpacesPlaceholder';
import { RecentlyBase } from './RecentlyBase';
import { SpaceCard } from './SpaceCard';
import { useBaseList } from './useBaseList';
import { useSpaceListOrdered } from './useSpaceListOrdered';

export const SpacePage: FC = () => {
  const isCloud = useIsCloud();
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const isHydrated = useIsHydrated();

  useTemplateMonitor();
  useSpaceSubscriptionMonitor();

  const orderedSpaceList = useSpaceListOrdered();

  const baseList = useBaseList();

  const { data: subscriptionList } = useQuery({
    queryKey: ReactQueryKeys.subscriptionSummaryList(),
    queryFn: () => getSubscriptionSummaryList().then((data) => data.data),
    enabled: isCloud,
  });

  const { disallowSpaceInvitation } = useSetting();

  const subscriptionMap = useMemo(() => {
    if (subscriptionList == null) return {};
    return keyBy(subscriptionList, 'spaceId');
  }, [subscriptionList]);

  // Check if we should show the empty workspace placeholder (no spaces)
  const shouldShowEmptyWorkspace = useMemo(() => {
    return orderedSpaceList.length === 0;
  }, [orderedSpaceList]);

  // Check if we should show the empty space placeholder
  const shouldShowEmptyPlaceholder = useMemo(() => {
    if (orderedSpaceList.length === 1 && baseList) {
      const singleSpace = orderedSpaceList[0];
      const basesInSpace = baseList.filter(({ spaceId }) => spaceId === singleSpace.id);
      return basesInSpace.length === 0;
    }
    return false;
  }, [orderedSpaceList, baseList]);

  if (shouldShowEmptyWorkspace || shouldShowEmptyPlaceholder) {
    return (
      <div ref={ref} className="flex h-screen flex-1 flex-col overflow-hidden py-8">
        <div className="flex items-center justify-between px-12">
          <h1 className="text-2xl font-semibold">
            {shouldShowEmptyWorkspace
              ? t('space:allSpaces')
              : orderedSpaceList[0]?.name || t('space:allSpaces')}
          </h1>
        </div>
        <div className="flex-1 overflow-y-auto px-8 pt-8 sm:px-12">
          {shouldShowEmptyWorkspace ? (
            <NoSpacesPlaceholder />
          ) : (
            <NoBasesPlaceholder space={orderedSpaceList[0]} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="flex h-screen flex-1 flex-col overflow-hidden py-8">
      <div className="flex items-center justify-between px-12">
        <h1 className="text-2xl font-semibold">{t('space:allSpaces')}</h1>
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
      {isHydrated && <FreshSettingGuideDialog />}
    </div>
  );
};
