import { X } from '@teable-group/icons';
import { Button, cn } from '@teable-group/ui-lib';
import { noop } from 'lodash';

interface ILinkCardProps {
  title?: string;
  readonly?: boolean;
  className?: string;
  wrapClassName?: string;
  onClick?: () => void;
  onDelete?: () => void;
}

export const LinkCard = (props: ILinkCardProps) => {
  const { title, readonly, className, wrapClassName, onClick, onDelete } = props;
  return (
    <div
      tabIndex={-1}
      role={'button'}
      className={cn(
        'group relative w-full cursor-pointer rounded-md border px-4 py-2 shadow-sm',
        wrapClassName
      )}
      onClick={onClick}
      onKeyDown={noop}
    >
      <div className={cn('w-full font-mono text-sm', className)} title={title || 'Unnamed record'}>
        {title || 'Unnamed record'}
      </div>
      {!readonly && (
        <Button
          className="absolute right-0 top-0 h-4 w-4 -translate-y-1/2 translate-x-1/2 rounded-full md:opacity-0 md:group-hover:opacity-100"
          size={'icon'}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
        >
          <X />
        </Button>
      )}
    </div>
  );
};
