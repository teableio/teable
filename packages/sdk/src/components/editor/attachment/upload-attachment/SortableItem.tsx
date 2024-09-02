import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@teable/ui-lib';
import React from 'react';
import { isSystemFileIcon } from '../utils';

interface IUploadAttachment {
  id: number | string;
  mimetype: string;
  name: string;
  src: string;
}

export function SortableItem(props: IUploadAttachment) {
  const { name, id, mimetype, src } = props;

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <li key={id} className="mb-2 flex h-32 w-28 flex-col pr-3">
        <div
          className={cn(
            'group relative hover:shadow transition flex-1 cursor-pointer overflow-hidden rounded-md border border-border',
            {
              'border-none': isSystemFileIcon(mimetype),
            }
          )}
        >
          <img className="size-full object-contain" src={src} alt={name} />
        </div>
        <span className="mt-1 w-full truncate text-center" title={name}>
          {name}
        </span>
      </li>
    </div>
  );
}
