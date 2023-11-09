import { useTablePermission, useViewId, useViews } from '@teable-group/sdk';
import classNames from 'classnames';
import { ViewListItem } from './ViewListItem';

export const ViewList: React.FC<{ className?: string }> = ({ className }) => {
  const views = useViews();
  const activeViewId = useViewId();
  const permission = useTablePermission();
  return (
    <div className={classNames('flex items-center gap-1 h-full', className)}>
      {views.map((view) => (
        <ViewListItem
          key={view.id}
          view={view}
          removable={permission['view|delete'] && views.length > 1}
          isActive={view.id === activeViewId}
        />
      ))}
    </div>
  );
};
