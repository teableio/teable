import { ChevronsLeft, ChevronsUpDown, Teable } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';
import { useIsHydrated } from '@/lib/use-is-hydrated';
import { ThemePicker } from '../../components/ThemePicker';

export const SideBarHeader: React.FC = () => {
  const isHydrated = useIsHydrated();

  return (
    <div className="flex m-2 gap-2 items-center">
      <Teable className="w-6 h-6" />
      <div>My Workspace</div>
      <Button variant="ghost" size={'xs'}>
        <ChevronsUpDown className="w-6 h-6" />
      </Button>

      <div className="grow"></div>
      {isHydrated && <ThemePicker />}
      <Button variant="ghost" size={'xs'}>
        <ChevronsLeft className="w-6 h-6" />
      </Button>
    </div>
  );
};
