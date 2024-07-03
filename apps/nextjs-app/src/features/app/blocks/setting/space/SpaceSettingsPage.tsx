import { useRouter } from 'next/router';
import React, { type FC } from 'react';
import { AccessPage } from '@/features/app/blocks/setting/space/access/Page';
import { BillingPage } from '@/features/app/blocks/setting/space/billing/Page';
import { GeneralPage } from '@/features/app/blocks/setting/space/general/Page';
import { HooksPage } from '@/features/app/blocks/setting/space/hooks/Page';
import { SpaceSpaceSettingContent } from '@/features/app/blocks/setting/space/SpaceSettingContent';
import { SpaceSettingSideHead } from '@/features/app/blocks/setting/space/SpaceSettingHead';
import { SpaceSettingSideBar } from '@/features/app/blocks/setting/space/SpaceSettingSideBar';
import { UsagePage } from '@/features/app/blocks/setting/space/usage/Page';

export const SpaceSettingsPage: FC = () => {
  const router = useRouter();
  const setting = router.query?.setting && router.query.setting[0];

  const settingPage = () => {
    switch (setting) {
      case 'general': {
        return <GeneralPage />;
      }
      case 'access': {
        return <AccessPage />;
      }
      case 'billing': {
        return <BillingPage />;
      }
      case 'usage': {
        return <UsagePage />;
      }
      case 'hooks': {
        return <HooksPage />;
      }
      default: {
        return <GeneralPage />;
      }
    }
  };

  return (
    <>
      <SpaceSettingSideHead />
      <div className="flex flex-1 overflow-hidden">
        <SpaceSettingSideBar />
        <SpaceSpaceSettingContent>{settingPage()}</SpaceSpaceSettingContent>
      </div>
    </>
  );
};
