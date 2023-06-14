import { useViewId, useViews } from '@teable-group/sdk';
import AddBoldIcon from '@teable-group/ui-lib/icons/app/add-bold.svg';
import { Button } from '@/components/ui/button';
import { useAddView } from './useAddView';
import { ViewListItem } from './ViewListItem';

export const ViewList: React.FC = () => {
  const views = useViews();
  const activeViewId = useViewId();
  const addView = useAddView();
  return (
    <div className="mx-2 flex pt-2 items-center space-x-2">
      {views.map((view) => (
        <ViewListItem key={view.id} view={view} isActive={view.id === activeViewId} />
      ))}
      <Button
        size={'xxs'}
        variant={'ghost'}
        // className="flex items-center space-x-2"
        onClick={addView}
      >
        <AddBoldIcon />
        View
      </Button>
    </div>
  );
};
