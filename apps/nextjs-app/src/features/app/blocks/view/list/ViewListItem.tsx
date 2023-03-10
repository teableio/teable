import { useTableId } from '@teable-group/sdk/hooks';
import type { View } from '@teable-group/sdk/model';
import classnames from 'classnames';
import Link from 'next/link';
import { useState } from 'react';

interface IProps {
  view: View;
  isActive: boolean;
}

export const ViewListItem: React.FC<IProps> = ({ view, isActive }) => {
  const [isEditing, setIsEditing] = useState(false);
  const tableId = useTableId();

  return (
    <>
      <Link
        href={{
          pathname: '/space/[tableId]/[viewId]',
          query: { tableId: tableId, viewId: view.id },
        }}
        className={classnames(
          'tab tab-bordered text-ellipsis overflow-hidden whitespace-nowrap inline-block',
          {
            'tab-active': isActive,
          }
        )}
        style={{ maxWidth: 200 }}
        title={view.name}
        onDoubleClick={() => {
          setIsEditing(true);
        }}
        onClick={(e) => {
          if (isActive) {
            e.preventDefault();
          }
        }}
      >
        {view.name}
      </Link>
      {isEditing && (
        <input
          type="text"
          placeholder="name"
          defaultValue={view.name}
          className="input input-bordered input-xs w-full cursor-text bg-base-100 absolute h-full px-4"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onBlur={(e) => {
            if (e.target.value && e.target.value !== view.name) {
              view.updateName(e.target.value);
            }
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.currentTarget.value && e.currentTarget.value !== view.name) {
                view.updateName(e.currentTarget.value);
              }
              setIsEditing(false);
            }
          }}
        />
      )}
    </>
  );
};
