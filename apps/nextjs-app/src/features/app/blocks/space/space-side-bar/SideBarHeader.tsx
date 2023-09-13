import { TeableNew } from '@teable-group/icons';
import { useIsHydrated } from '@teable-group/sdk';
import { ThemePicker } from '../../../components/ThemePicker';

export const SideBarHeader: React.FC = () => {
  const isHydrated = useIsHydrated();

  return (
    <div className="flex m-2 gap-1 items-center">
      <TeableNew className="w-6 h-6 shrink-0" />
      <p className="text-sm overflow-hidden text-ellipsis whitespace-nowrap">Table</p>
      <div className="grow basis-0"></div>
      {isHydrated && <ThemePicker className="px-1" />}
    </div>
  );
};
