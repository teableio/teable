import { ViewType } from '@teable/core';
import { Lock, Star } from '@teable/icons';
import {
  useContentDir,
  useIsReadOnlyPreview,
  useTableId,
  useTablePermission,
} from '@teable/sdk/hooks';
import type { IViewInstance } from '@teable/sdk/model';
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  PopoverTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { ChevronDown, List } from 'lucide-react';
import { useState, useRef, Fragment, useEffect } from 'react';
import { useIsInIframe } from '@/features/app/hooks/useIsInIframe';
import { useNavigateToView } from '@/features/app/hooks/useResourceNavigation';
import { usePinMap } from '../../space/usePinMap';
import { VIEW_ICON_MAP } from '../constant';
import { useGridSearchStore } from '../grid/useGridSearchStore';
import { useViewActions } from './useViewActions';
import { ViewNameInput } from './ViewNameInput';

interface IProps {
  view: IViewInstance;
  removable: boolean;
  isActive: boolean;
  onEdit: (value: boolean) => void;
  /**
   * Shows the item as the current view's title instead of a tab: plain text, no fill, a chevron,
   * and a click opens the view list (it must sit inside `ExpandViewList`'s popover) instead of
   * navigating. A right-click still opens the view's menu.
   */
  asListTrigger?: boolean;
  /** Whether the view list it opens is open. */
  listOpen?: boolean;
}

export const ViewListItem: React.FC<IProps> = ({
  view,
  removable,
  isActive,
  onEdit,
  asListTrigger: asMenu,
  listOpen,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  // The title's right-click menu, which opens under it rather than at the pointer.
  const [menuOpen, setMenuOpen] = useState(false);
  const tableId = useTableId() as string;
  const navigateToView = useNavigateToView();
  const permission = useTablePermission();
  const contentDir = useContentDir();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewItemRef = useRef<HTMLDivElement>(null);
  const { highlightedViewId } = useGridSearchStore();
  const isHighlighted = highlightedViewId === view.id;
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const { renderItems, dialogs } = useViewActions({
    view,
    removable,
    onRename: () => {
      setIsEditing(true);
      onEdit(true);
    },
  });

  const { resetSearchHandler } = useGridSearchStore();
  const isInIframe = useIsInIframe();

  useEffect(() => {
    if (isActive && !isInIframe) {
      setTimeout(() => {
        viewItemRef.current?.scrollIntoView({
          behavior: 'smooth',
        });
      }, 0);
    }
  }, [isActive, isInIframe]);

  const navigateHandler = () => {
    if (asMenu) return;
    resetSearchHandler?.();
    navigateToView(tableId, view.id);
  };
  const ViewIcon = VIEW_ICON_MAP[view.type];
  const pinMap = usePinMap();
  const isPin = pinMap?.[view.id];

  const commonPart = (
    <div className="relative flex w-full items-center overflow-hidden px-0.5">
      {/* The list icon says the title opens the view list, as the list button it replaced did. */}
      {asMenu && <List className="me-2 size-4 shrink-0" />}
      {view.type === ViewType.Plugin ? (
        <img className="me-1 size-4 shrink-0" src={view.options.pluginLogo} alt={view.name} />
      ) : (
        <Fragment>
          {view.isLocked && !asMenu && <Lock className="me-[2px] size-4 shrink-0" />}
          <ViewIcon className="me-1 size-4 shrink-0" />
        </Fragment>
      )}
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <div
          dir={contentDir}
          className={cn('truncate text-xs font-medium leading-5', asMenu && 'text-sm')}
        >
          {view.name}
        </div>
      </div>
      {/* The title puts the lock after the name, as the list's rows do. */}
      {asMenu && view.isLocked && view.type !== ViewType.Plugin && (
        <Lock className="ms-1 size-4 shrink-0 text-muted-foreground" />
      )}
      {isPin && <Star className="ms-1 size-4 shrink-0 fill-yellow-400 text-yellow-400" />}
      {asMenu && (
        <ChevronDown
          className={cn(
            'ms-1 size-4 shrink-0 text-muted-foreground transition-transform',
            listOpen && 'rotate-180'
          )}
        />
      )}
      {isEditing && (
        <ViewNameInput
          view={view}
          className="absolute start-0 top-0 size-full py-0 text-xs"
          onDone={() => {
            setIsEditing(false);
            onEdit(false);
          }}
        />
      )}
    </div>
  );

  const item = (
    <div
      ref={viewItemRef}
      role="button"
      tabIndex={0}
      className={cn(
        'flex h-7 max-w-52 items-center overflow-hidden rounded-md p-1 text-sm hover:bg-accent',
        {
          'bg-accent': (isActive && !isHighlighted && !asMenu) || listOpen || menuOpen,
          'bg-orange-300/40 hover:bg-orange-300/40': isHighlighted,
        }
      )}
      onContextMenu={
        asMenu
          ? (e) => {
              e.preventDefault();
              if (!isEditing && !isReadOnlyPreview) setMenuOpen(true);
            }
          : undefined
      }
      onDoubleClick={() => {
        if (permission['view|update'] && !asMenu) {
          setIsEditing(true);
          onEdit(true);
        }
      }}
      onKeyDown={(e) => {
        if (isEditing) {
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          // The popover opens on click only.
          if (asMenu) {
            e.preventDefault();
            e.currentTarget.click();
            return;
          }
          navigateHandler();
        }
      }}
      onClick={() => {
        if (isEditing) {
          return;
        }
        navigateHandler();
      }}
    >
      <Button
        variant="ghost"
        size="xs"
        className={cn('m-0 flex w-full rounded-sm hover:bg-transparent p-0', {
          'bg-secondary': isActive && !isHighlighted && !asMenu,
          'bg-orange-300/40': isHighlighted,
        })}
      >
        {commonPart}
      </Button>
      <iframe ref={iframeRef} title="This for export csv download" style={{ display: 'none' }} />
    </div>
  );

  return (
    <>
      {asMenu ? (
        <div className="relative flex min-w-0">
          <PopoverTrigger asChild>{item}</PopoverTrigger>
          {/* An inert anchor over the title, so the right-click menu opens under it. */}
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <span aria-hidden tabIndex={-1} className="pointer-events-none absolute inset-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
              {renderItems('dropdown')}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={isEditing || isReadOnlyPreview}>
            {item}
          </ContextMenuTrigger>
          <ContextMenuContent>{renderItems('context')}</ContextMenuContent>
        </ContextMenu>
      )}
      {dialogs}
    </>
  );
};
