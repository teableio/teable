import { useActiveViewId, useViews } from '@teable-group/sdk';
import classnames from 'classnames';

export const ViewList: React.FC = () => {
  const views = useViews();
  const activeViewId = useActiveViewId();
  return (
    <div className="tabs">
      {views.map((view) => (
        <a
          key={view.id}
          className={classnames('tab', 'tab-lifted', {
            'tab-active': activeViewId === view.id,
          })}
        >
          {view.name}
        </a>
      ))}
    </div>
  );
};
