import { verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Check, DraggableHandle, Lock, MoreHorizontal, Star } from '@teable/icons';
import { useIsReadOnlyPreview, useTablePermission, useViewId, useViews } from '@teable/sdk/hooks';
import type { IViewInstance } from '@teable/sdk/model';
import {
  Popover,
  PopoverTrigger,
  Button,
  PopoverContent,
  CommandInput,
  CommandEmpty,
  CommandList,
  CommandItem,
  Command,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { List } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { Fragment, useState, type ReactNode } from 'react';
import { useCompactResourceChrome } from '@/features/app/hooks/useCompactResourceChrome';
import { tableConfig } from '@/features/i18n/table.config';
import { useBaseResource, type IBaseResourceTable } from '../../../hooks/useBaseResource';
import { useNavigateToView } from '../../../hooks/useResourceNavigation';
import { usePinMap } from '../../space/usePinMap';
import { VIEW_ICON_MAP } from '../constant';
import { DraggableWrapper } from './DraggableWrapper';
import { useViewActions } from './useViewActions';
import { ViewNameInput } from './ViewNameInput';

type IDragProps = Pick<
  Parameters<React.ComponentProps<typeof DraggableWrapper>['children']>[0],
  'setNodeRef' | 'attributes' | 'listeners' | 'style' | 'isDragging'
>;

/**
 * One view in the list: the drag handle first, a star when it is starred, and the view's menu
 * from a right-click or the "more" button that shows on hover (not in a read-only preview, as on
 * the view tabs).
 */
const ViewListRow = ({
  view,
  removable,
  draggable,
  drag,
  onSelect,
  active,
}: {
  view: IViewInstance;
  removable: boolean;
  draggable: boolean;
  drag: IDragProps;
  onSelect: () => void;
  /** The current view: it keeps its surface fill while the pointer highlights other rows (accent). */
  active: boolean;
}) => {
  const { id, name, type } = view;
  const Icon = VIEW_ICON_MAP[type];
  const isPin = usePinMap()?.[id];
  const [isEditing, setIsEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { renderItems, dialogs } = useViewActions({
    view,
    removable,
    onRename: () => setIsEditing(true),
  });
  const { setNodeRef, attributes, listeners, style, isDragging } = drag;
  const hasMenu = !useIsReadOnlyPreview();

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={isEditing || !hasMenu}>
          <CommandItem
            value={id}
            keywords={[name]}
            ref={setNodeRef}
            style={{ ...style, opacity: isDragging ? '0.6' : '1' }}
            // Match a menu item: 32px tall, 8px padding, default cursor.
            className={cn('group cursor-default gap-2', active && 'bg-surface')}
            onSelect={() => {
              if (!isEditing) onSelect();
            }}
          >
            <div
              {...(draggable ? { ...attributes, ...listeners } : {})}
              className={cn(
                'flex size-4 shrink-0 items-center justify-center text-muted-foreground',
                draggable ? 'cursor-grab' : 'invisible'
              )}
            >
              <DraggableHandle className="size-3" />
            </div>
            <Icon className="size-4 shrink-0" />
            {isEditing ? (
              <ViewNameInput
                view={view}
                className="h-6 min-w-0 flex-1 px-1 text-sm"
                onDone={() => setIsEditing(false)}
              />
            ) : (
              <span className="truncate text-sm" title={name}>
                {name}
              </span>
            )}
            {view.isLocked && !isEditing && (
              <Lock className="size-4 shrink-0 text-muted-foreground" />
            )}
            {isPin && !isEditing && (
              <Star className="size-4 shrink-0 fill-yellow-400 text-yellow-400" />
            )}
            <span className="grow" />
            {!hasMenu && active && <Check className="size-4 shrink-0" />}
            {!isEditing && hasMenu && (
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      '-me-1 size-5 shrink-0',
                      // The current view shows a check in this slot until the pointer is on it.
                      !active &&
                        'opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100',
                      menuOpen && 'opacity-100'
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {active && !menuOpen && <Check className="size-4 group-hover:hidden" />}
                    <MoreHorizontal
                      className={cn('size-4', active && !menuOpen && 'hidden group-hover:block')}
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  // 4px clear of the list: the button's end sits 9px inside it (the popover's
                  // 1px border and 4px padding, the row's 8px padding less the button's -4px).
                  sideOffset={13}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  // A portal's clicks still bubble through React to the row, which would select it.
                  onClick={(e) => e.stopPropagation()}
                >
                  {renderItems('dropdown')}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </CommandItem>
        </ContextMenuTrigger>
        <ContextMenuContent onClick={(e) => e.stopPropagation()}>
          {renderItems('context')}
        </ContextMenuContent>
      </ContextMenu>
      {dialogs}
    </>
  );
};

/**
 * The row that follows the pointer while a view is dragged: opaque and raised, so it doesn't read
 * as a ghost over the rows it passes.
 */
const ViewDragOverlay = ({ view }: { view: IViewInstance }) => {
  const Icon = VIEW_ICON_MAP[view.type];
  const isPin = usePinMap()?.[view.id];
  return (
    <div className="flex h-8 w-full items-center gap-2 rounded-sm bg-popover px-2 text-sm shadow-md">
      <DraggableHandle className="size-4 shrink-0 p-0.5 text-muted-foreground" />
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{view.name}</span>
      {view.isLocked && <Lock className="size-4 shrink-0 text-muted-foreground" />}
      {isPin && <Star className="size-4 shrink-0 fill-yellow-400 text-yellow-400" />}
    </div>
  );
};

/**
 * The view list in a popover, opened from a list button. Compact chrome lists starred views first
 * under group titles; `footer` stays pinned under the list, given a way to close the popover.
 * `trigger` replaces the list button and must hold a `PopoverTrigger`; it is told whether the
 * list is open.
 */
export const ExpandViewList = ({
  footer,
  trigger,
}: {
  footer?: (close: () => void) => ReactNode;
  trigger?: (open: boolean) => ReactNode;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [open, setOpen] = useState(false);
  const [isDraggable, setIsDraggable] = useState(true);
  const [highlightedValue, setHighlightedValue] = useState<string | undefined>();
  const permission = useTablePermission();
  const { tableId } = useBaseResource() as IBaseResourceTable;
  const navigateToView = useNavigateToView();
  const curViewId = useViewId();
  const views = useViews();
  const compact = useCompactResourceChrome();
  const pinMap = usePinMap();
  // Compact chrome lists the reader's starred views first.
  const starredIds = compact
    ? views.filter((view) => pinMap?.[view.id]).map(({ id }) => id)
    : undefined;

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      // The current view has its own fill and check, so nothing starts highlighted.
      setHighlightedValue('');
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {trigger ? (
        trigger(open)
      ) : (
        <PopoverTrigger asChild>
          <Button className="shrink-0" size="icon-xs" variant="ghost">
            <List className="size-4" />
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent
        side="bottom"
        align="start"
        // The list and footer pad themselves, so both dividers run edge to edge.
        className="w-auto min-w-56 max-w-[456px] p-0"
      >
        <Command
          value={highlightedValue}
          onValueChange={setHighlightedValue}
          filter={(value, search, keywords) => {
            const searchLower = search.toLowerCase();
            if (keywords?.some((keyword) => keyword.toLowerCase().includes(searchLower))) {
              return 1;
            }
            return 0;
          }}
        >
          <CommandInput
            className="h-8"
            containerClassName="h-9 px-3 py-0"
            placeholder={t('table:view.searchView')}
            onValueChange={(value) => setIsDraggable(!value)}
          />
          <CommandEmpty>{t('common:noResult')}</CommandEmpty>
          {/* The list pads its end inside the scroll, so rows run up to the footer's divider. */}
          <CommandList className="max-h-[60vh] p-1">
            <DraggableWrapper
              strategy={verticalListSortingStrategy}
              firstIds={starredIds}
              renderOverlay={(view) => <ViewDragOverlay view={view} />}
            >
              {({ view, setNodeRef, attributes, listeners, style, isDragging, groupStart }) => {
                const select = () => {
                  navigateToView(tableId, view.id);
                  setOpen(false);
                };
                // With starred views, each group gets a title, which also says why a view won't
                // drag into the other group. Searching shows one flat list.
                const heading = isDraggable && groupStart && (
                  <div
                    className={cn(
                      'px-2 pb-1 pt-1.5 text-xs text-muted-foreground',
                      groupStart === 'rest' && 'mt-1'
                    )}
                  >
                    {t(
                      groupStart === 'first' ? 'table:view.starredGroup' : 'table:view.otherGroup'
                    )}
                  </div>
                );
                return (
                  <Fragment key={view.id}>
                    {heading}
                    <ViewListRow
                      view={view}
                      removable={Boolean(permission['view|delete']) && views.length > 1}
                      draggable={isDraggable && Boolean(permission['view|update'])}
                      drag={{ setNodeRef, attributes, listeners, style, isDragging }}
                      onSelect={select}
                      active={view.id === curViewId}
                    />
                  </Fragment>
                );
              }}
            </DraggableWrapper>
          </CommandList>
        </Command>
        {footer && <div className="border-t p-1">{footer(() => handleOpenChange(false))}</div>}
      </PopoverContent>
    </Popover>
  );
};
