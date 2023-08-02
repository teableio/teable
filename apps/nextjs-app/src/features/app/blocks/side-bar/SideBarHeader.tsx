import { ChevronsUpDown, Teable } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';
import { useIsHydrated } from '@/lib/use-is-hydrated';
import { ThemePicker } from '../../components/ThemePicker';

export const SideBarHeader: React.FC = () => {
  const isHydrated = useIsHydrated();

  return (
    <div className="flex m-2 gap-0 items-center">
      <Teable className="w-6 h-6 shrink-0" />
      <p className="text-sm overflow-hidden text-ellipsis whitespace-nowrap">My Workspace</p>
      <Button className="px-1" variant="ghost" size={'xs'}>
        <ChevronsUpDown className="w-4 h-4" />
      </Button>

      <div className="grow basis-0"></div>
      {isHydrated && <ThemePicker className="px-1" />}
    </div>
  );
};
