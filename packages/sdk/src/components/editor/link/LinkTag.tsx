import { X } from '@teable/icons';
import { cn } from '@teable/ui-lib';
import type { KeyboardEvent } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { CellLink } from '../../cell-value/cell-link';

interface ILinkTagProps {
  id: string;
  title?: string;
  readonly?: boolean;
  className?: string;
  onClick?: () => void;
  onDelete?: () => void;
}

/**
 * One linked record in the record detail. The label is the same compact chip the
 * grid paints for a link cell (CellLink), so the field reads like the grid's cell
 * instead of a full-width child table, and a click opens the linked record.
 *
 * The unlink control lives inside the item and is only faded out, never removed
 * from the flow: the row keeps its width on hover and nothing can push the tags
 * past the field's right edge.
 */
export const LinkTag = (props: ILinkTagProps) => {
  const { id, title, readonly, className, onClick, onDelete } = props;
  const { t } = useTranslation();
  const label = title || t('common.untitled');

  // Keyboard parity with the link child table this field replaced: the item is a
  // `role=button` div, so Enter/Space have to be spelled out. Both go through the
  // one handler the click uses, which readonly items leave unwired.
  const openRecord = readonly ? undefined : onClick;

  const onOpenKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!openRecord || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openRecord();
  };

  const onUnlinkKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Cancel the button's own activation and keep the key away from the item:
    // Enter on the unlink control unlinks, it never opens the record.
    event.preventDefault();
    event.stopPropagation();
    onDelete?.();
  };

  return (
    <div
      role={'button'}
      tabIndex={0}
      className={cn(
        'group/link-tag inline-flex max-w-full items-center',
        !readonly && 'cursor-pointer',
        className
      )}
      onClick={openRecord}
      onKeyDown={onOpenKeyDown}
    >
      <CellLink value={{ id, title: label }} className="min-w-0 max-w-full" ellipsis />
      {!readonly && (
        <button
          type="button"
          tabIndex={0}
          aria-label={t('common.remove')}
          className="ms-0.5 flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-foreground/10 md:opacity-0 md:transition-opacity md:focus-visible:opacity-100 md:group-hover/link-tag:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          onKeyDown={onUnlinkKeyDown}
        >
          <X className="size-3 shrink-0" />
        </button>
      )}
    </div>
  );
};
