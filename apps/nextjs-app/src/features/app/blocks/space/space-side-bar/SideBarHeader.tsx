import { TeableNew } from '@teable-group/icons';
import { useIsHydrated } from '@teable-group/sdk';
import { ThemePicker } from '../../../components/ThemePicker';

export const SideBarHeader: React.FC = () => {
  const isHydrated = useIsHydrated();

  return (
    <div className="m-2 flex items-center gap-1">
      <TeableNew className="h-6 w-6 shrink-0" />
      <p className="truncate text-sm">Table</p>
      <div className="grow basis-0"></div>
      {isHydrated && <ThemePicker className="px-1" />}
    </div>
  );
};
