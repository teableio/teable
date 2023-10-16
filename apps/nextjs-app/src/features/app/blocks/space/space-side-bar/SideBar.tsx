import { SideBarFooter } from '@/features/app/components/SideBarFooter';
import { SideBarHeader } from './SideBarHeader';
import { SpaceSideBar } from './SpaceSideBar';

export const SideBar = () => {
  return (
    <div className="flex h-full basis-[300px] flex-col overflow-hidden border-r">
      <SideBarHeader />
      <div className="divide-base-300 flex flex-col gap-2 divide-y divide-solid overflow-hidden py-2">
        <SpaceSideBar />
      </div>
      <div className="grow basis-0"></div>
      <SideBarFooter />
    </div>
  );
};
