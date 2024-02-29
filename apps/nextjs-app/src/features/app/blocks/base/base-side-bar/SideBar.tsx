import classNames from 'classnames';
import { SideBarFooter } from '@/features/app/components/SideBarFooter';
import { BaseSideBar } from './BaseSideBar';
import { SideBarHeader } from './SideBarHeader';

export interface ISideBarInteractionProps {
  expandSideBar?: () => void;
}

export const SideBar = (props: ISideBarInteractionProps) => {
  return (
    <div className="relative size-full bg-popover">
      <div className={classNames('width-full flex h-full basis-[300px] flex-col')}>
        <SideBarHeader {...props} />
        <div className="divide-base-300 flex flex-col gap-2 divide-y divide-solid overflow-auto py-2">
          <BaseSideBar />
        </div>
        <div className="grow basis-0"></div>
        <SideBarFooter />
      </div>
    </div>
  );
};
