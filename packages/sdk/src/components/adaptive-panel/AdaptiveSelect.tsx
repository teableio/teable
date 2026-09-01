import { useState } from 'react';
import type { IDrawerOption } from './DrawerOptionList';
import { DrawerOptionList } from './DrawerOptionList';
import { useInDrawer } from './DrawerStackContext';
import { NestedDrawer } from './NestedDrawer';

export interface IAdaptiveSelectProps {
  /** Title of the stacked drawer. Ignored on desktop. */
  title: string;
  options: IDrawerOption[];
  value?: string | string[] | null;
  onSelect: (value: string) => void;
  search?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Keep the stacked drawer open after a pick. Multi-select only. */
  keepOpenOnSelect?: boolean;
  /**
   * `list` pins the drawer at 60dvh. Use it whenever a search box is present,
   * so filtering does not make the panel jump; leave it `auto` for short
   * fixed lists such as sort order.
   */
  size?: 'auto' | 'list';
  /** The existing desktop control, rendered unchanged outside a drawer. */
  desktop: React.ReactNode;
  /** The row that opens the stacked drawer. */
  trigger: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The one and only stacked-selector implementation.
 *
 * Outside a drawer this renders the caller's existing desktop control
 * verbatim, so desktop behaviour and styling are untouched. Inside a drawer
 * it renders a second-level drawer with the shared option list.
 *
 * Note this keys off `useInDrawer()`, not the viewport: a select on a narrow
 * screen that is *not* inside a drawer - the field-setting sheet, the query
 * builder - keeps its popover.
 */
export const AdaptiveSelect = (props: IAdaptiveSelectProps) => {
  const {
    title,
    options,
    value,
    onSelect,
    search,
    searchPlaceholder,
    emptyText,
    keepOpenOnSelect,
    size,
    desktop,
    trigger,
    open: openProp,
    onOpenChange,
  } = props;

  const inDrawer = useInDrawer();
  const [innerOpen, setInnerOpen] = useState(false);

  const open = openProp ?? innerOpen;
  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };

  if (!inDrawer) return <>{desktop}</>;

  return (
    <NestedDrawer
      open={open}
      onOpenChange={setOpen}
      title={title}
      size={size ?? (search ? 'list' : 'auto')}
      content={
        <DrawerOptionList
          options={options}
          value={value}
          search={search}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          onSelect={(next) => {
            onSelect(next);
            if (!keepOpenOnSelect) setOpen(false);
          }}
        />
      }
    >
      {trigger}
    </NestedDrawer>
  );
};
