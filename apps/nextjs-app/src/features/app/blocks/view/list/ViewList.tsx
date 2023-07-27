import { Plus } from '@teable-group/icons';
import { useViewId, useViews } from '@teable-group/sdk';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { useAddView } from './useAddView';
import { ViewListItem } from './ViewListItem';

export const ViewList: React.FC = () => {
  const views = useViews();
  const activeViewId = useViewId();
  const addView = useAddView();
  return (
    <div className="mx-2 flex py-2 items-center space-x-1">
      {views.map((view) => (
        <ViewListItem
          key={view.id}
          view={view}
          removable={views.length > 1}
          isActive={view.id === activeViewId}
        />
      ))}
      <Button
        className="w-7 h-7 ml-2"
        size={'xs'}
        variant={'outline'}
        // className="flex items-center space-x-2"
        onClick={addView}
      >
        <Plus className="w-4 h-4" />
      </Button>
    </div>
  );
};
