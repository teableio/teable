import type { DehydratedState } from '@tanstack/react-query';
import { LastVisitResourceType, updateUserLastVisit } from '@teable/openapi';
import type { IUser } from '@teable/sdk';
import { NotificationProvider, SessionProvider } from '@teable/sdk';
import { AppProvider } from '@teable/sdk/context';
import { isString } from 'lodash';
import { useParams } from 'next/navigation';
import { useTranslation } from 'next-i18next';
import React, { Fragment, useEffect } from 'react';
import { LicenseExpiryBanner } from '@/features/app/components/LicenseExpiryBanner';
import { AppLayout } from '@/features/app/layouts';
import { SpaceInnerSettingModal } from '@overridable/SpaceInnerSettingModal';
import { SpaceInnerSideBar } from '../blocks/space/space-side-bar/SpaceInnerSideBar';
import { SpaceQuickSearch } from '../blocks/space/space-side-bar/SpaceQuickSearch';
import { SpaceSwitcher } from '../blocks/space/space-side-bar/SpaceSwitcher';
import { Sidebar } from '../components/sidebar/Sidebar';
import { SideBarFooter } from '../components/SideBarFooter';
import { useSdkLocale } from '../hooks/useSdkLocale';
import { SpacePageTitle } from './SpacePageTitle';

export const SpaceInnerLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  dehydratedState?: DehydratedState;
}> = ({ children, user, dehydratedState }) => {
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  const { spaceId } = useParams<{ spaceId: string }>();

  useEffect(() => {
    if (!spaceId || !isString(spaceId)) {
      return;
    }
    updateUserLastVisit({
      resourceType: LastVisitResourceType.Space,
      resourceId: spaceId,
      parentResourceId: '',
    });
  }, [spaceId]);

  const renderSettingModal = (children: React.ReactNode) => {
    return <SpaceInnerSettingModal>{children}</SpaceInnerSettingModal>;
  };

  return (
    <AppLayout>
      <SpacePageTitle dehydratedState={dehydratedState} />
      <AppProvider locale={sdkLocale} lang={i18n.language} dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <NotificationProvider>
            <LicenseExpiryBanner />
            <div id="portal" className="relative flex h-screen w-full items-start">
              <Sidebar
                headerLeft={<SpaceSwitcher />}
                headerRight={<SpaceQuickSearch spaceId={spaceId} />}
              >
                <Fragment>
                  <div className="flex flex-1 flex-col gap-1 divide-y divide-solid overflow-hidden">
                    <SpaceInnerSideBar renderSettingModal={renderSettingModal} />
                  </div>
                  <SideBarFooter />
                </Fragment>
              </Sidebar>
              {children}
            </div>
          </NotificationProvider>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
