import { SideBarFooter } from '@/features/app/components/SideBarFooter';
import { BaseSideBar } from './BaseSideBar';
import { SideBarHeader } from './SideBarHeader';

export const SideBar = () => {
  return (
    <div className="flex h-full flex-col overflow-hidden basis-[300px]">
      <SideBarHeader />
      <div className="divide-base-300 divide-y divide-solid flex flex-col overflow-hidden py-2 gap-2">
        <BaseSideBar />
      </div>
      <div className="grow basis-0"></div>
      <SideBarFooter />
    </div>
  );
};
