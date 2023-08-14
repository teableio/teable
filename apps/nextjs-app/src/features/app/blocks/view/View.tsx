import { useIsHydrated } from '@/lib/use-is-hydrated';
import { ExpandRecordContainer } from '../../components/ExpandRecordContainer';
import { GridView } from './grid/GridView';

export const View = () => {
  const isHydrated = useIsHydrated();

  return (
    <div className="w-full grow overflow-hidden">
      {isHydrated && <GridView />}
      {isHydrated && <ExpandRecordContainer />}
    </div>
  );
};
