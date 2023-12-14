import { SideBarFooter } from '@/features/app/components/SideBarFooter';
import { BaseSideBar } from './BaseSideBar';
import { SideBarHeader } from './SideBarHeader';

export const SideBar = () => {
  return (
    <div className="flex h-full basis-[300px] flex-col overflow-hidden">
      <SideBarHeader />
      <div className="divide-base-300 flex flex-col gap-2 divide-y divide-solid overflow-hidden py-2">
        <BaseSideBar />
      </div>
      <div className="grow basis-0"></div>
      <SideBarFooter />
    </div>
  );
};
