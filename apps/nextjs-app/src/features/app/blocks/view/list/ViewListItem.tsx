import { useTableId } from '@teable-group/sdk/hooks';
import type { View } from '@teable-group/sdk/model';
import classnames from 'classnames';
import Link from 'next/link';
import { useState } from 'react';
import { Input } from '@/components/ui/input';

interface IProps {
  view: View;
  isActive: boolean;
}

export const ViewListItem: React.FC<IProps> = ({ view, isActive }) => {
  const [isEditing, setIsEditing] = useState(false);
  const tableId = useTableId();

  return (
    <div
      className={classnames('border-b-2 border-transparent hover:border-border  ', {
        'text-accent-foreground border-foreground hover:border-foreground': isActive,
        'text-accent-foreground/70 hover:text-accent-foreground': !isActive,
      })}
    >
      <Link
        href={{
          pathname: '/space/[tableId]/[viewId]',
          query: { tableId: tableId, viewId: view.id },
        }}
        className="p-2 text-ellipsis overflow-hidden whitespace-nowrap inline-block align-bottom text-base"
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
        {!isEditing && view.name}
        {isEditing && (
          <Input
            type="text"
            placeholder="name"
            defaultValue={view.name}
            className="w-full h-6 py-0 cursor-text focus-visible:ring-transparent focus-visible:ring-offset-0"
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
      </Link>
    </div>
  );
};
