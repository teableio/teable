import { useActiveViewId, useViews } from '@teable-group/sdk';
import classnames from 'classnames';

export const ViewList: React.FC = () => {
  const views = useViews();
  const activeViewId = useActiveViewId();
  return (
    <div className="tabs h-14 bg-base-200">
      {views.map((view, i) => (
        <a
          key={view.id}
          className={classnames('tab', 'tab-lifted', {
            'tab-active': activeViewId ? activeViewId === view.id : i === 0,
          })}
        >
          {view.name}
        </a>
      ))}
    </div>
  );
};
