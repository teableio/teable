import { ViewType, getUniqName } from '@teable/core';
import { Plus } from '@teable/icons';
import { useViews } from '@teable/sdk';
import { useTablePermission } from '@teable/sdk/hooks';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { VIEW_ICON_MAP } from '../../view/constant';
import { useAddView } from '../../view/list/useAddView';

export interface IAddViewProps {
  contentClassName?: string;
  /** `itemClassName` sizes the section's items like the menu's own. */
  renderExtraSection?: (close: () => void, itemClassName?: string) => ReactNode;
  /** Replaces the default "+" button. */
  trigger?: ReactNode;
  /**
   * Behaves as a submenu of the menu the trigger sits in: opens on hover to its side, 4px clear of
   * it, and sizes its items like that menu's (32px rows, 14px text).
   */
  submenu?: boolean;
  /** Called once a choice in the menu is made, after the menu closes. */
  onDone?: () => void;
}

export const AddView: React.FC<IAddViewProps> = ({
  contentClassName,
  renderExtraSection,
  trigger,
  submenu = false,
  onDone,
}) => {
  const addView = useAddView();
  const views = useViews();
  const permission = useTablePermission();
  const [isOpen, setOpen] = useState(false);
  const { t } = useTranslation('table');
  const close = () => {
    setOpen(false);
    onDone?.();
  };
  // Hover opens the submenu; leaving the trigger or the menu closes it after a moment, long enough
  // to cross the gap between them. A click (or a tap, which hovers first) opens it too, rather than
  // toggling shut what the hover just opened.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const openSubmenu = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverProps = submenu
    ? {
        onPointerEnter: openSubmenu,
        onPointerLeave: () => {
          closeTimer.current = setTimeout(() => setOpen(false), 150);
        },
      }
    : {};
  const triggerProps = submenu
    ? {
        ...hoverProps,
        // Radix's trigger toggles unless the click is prevented.
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          openSubmenu();
        },
      }
    : {};
  const itemClassName = submenu ? 'h-8 gap-2 px-2 text-sm' : undefined;

  const viewInfoList = [
    {
      name: t('view.category.table'),
      type: ViewType.Grid,
      Icon: VIEW_ICON_MAP[ViewType.Grid],
    },
    {
      name: t('view.category.gallery'),
      type: ViewType.Gallery,
      Icon: VIEW_ICON_MAP[ViewType.Gallery],
    },
    {
      name: t('view.category.kanban'),
      type: ViewType.Kanban,
      Icon: VIEW_ICON_MAP[ViewType.Kanban],
    },
    {
      name: t('view.category.calendar'),
      type: ViewType.Calendar,
      Icon: VIEW_ICON_MAP[ViewType.Calendar],
    },
    {
      name: t('view.category.form'),
      type: ViewType.Form,
      Icon: VIEW_ICON_MAP[ViewType.Form],
    },
  ];

  const onClick = (type: ViewType, name: string) => {
    const uniqueName = getUniqName(
      name.split(' ')[0],
      views?.map((view) => view.name)
    );
    addView(type, uniqueName);
    close();
  };

  if (!permission['view|create']) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild {...triggerProps}>
        {trigger ?? (
          <Button className="shrink-0" size="icon-xs" variant="outline">
            <Plus className="size-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        {...hoverProps}
        side={submenu ? 'right' : 'bottom'}
        align="start"
        // As a submenu: 4px clear of the parent menu, whose edge is 5px past the trigger (its 1px
        // border and 4px padding), with the first item level with the trigger.
        sideOffset={submenu ? 9 : undefined}
        alignOffset={submenu ? -5 : undefined}
        className={cn('w-36 p-1', contentClassName)}
      >
        {viewInfoList.map((item) => {
          const { name, type, Icon } = item;
          return (
            <Button
              key={type}
              variant={'ghost'}
              size={'xs'}
              className={cn('w-full justify-start font-normal', itemClassName)}
              onClick={() => onClick(type, name)}
            >
              <Icon className={submenu ? 'size-4 shrink-0' : 'pe-1 text-lg'} />
              {name}
            </Button>
          );
        })}
        {renderExtraSection?.(close, itemClassName)}
      </PopoverContent>
    </Popover>
  );
};
