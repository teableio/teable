import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandGroup,
  Popover,
  PopoverContent,
  PopoverTrigger,
  CommandList,
  cn,
} from '@teable/ui-lib';
import { debounce } from 'lodash';
import { Check, ChevronDown } from 'lucide-react';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../../../../../context/app/i18n';
import { NestedDrawer, useInDrawer } from '../../../../adaptive-panel';
import type { IOption, IBaseSelect } from './types';
import { scrollListByWheel } from './wheel-scroll-list';

interface ISelectOptionItemProps<O> {
  option: O;
  selected: boolean;
  inDrawer: boolean;
  defaultLabel?: React.ReactNode;
  optionRender?: (option: O) => React.ReactElement;
  onSelect: () => void;
}

/**
 * One row of the option list. Extracted so the leading/trailing check-mark
 * split does not thread extra branching through `BaseSingleSelect`.
 */
function SelectOptionItem<O extends IOption<string>>(props: ISelectOptionItemProps<O>) {
  const { option, selected, inDrawer, defaultLabel, optionRender, onSelect } = props;

  return (
    <CommandItem
      value={option.value}
      onSelect={onSelect}
      className={cn(
        'w-full truncate text-sm',
        inDrawer && 'h-9 gap-2 rounded-md px-3',
        inDrawer && selected && 'bg-accent text-accent-foreground'
      )}
    >
      {/* Leading tick on desktop, trailing tick in a drawer - the mobile
          convention here deliberately mirrors the desktop menus. */}
      {!inDrawer && (
        <Check className={cn('me-2 h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
      )}
      {/* Only wrapped in a drawer, where the trailing tick needs the label to
          claim the remaining width. On desktop the option body stays a direct
          flex child of the row, so content-sized `optionRender` output (colour
          chips, icon+name pairs) keeps its own width instead of stretching. */}
      {inDrawer ? (
        <span className="min-w-0 flex-1 truncate">
          {optionRender?.(option) ?? option.label ?? defaultLabel}
        </span>
      ) : (
        optionRender?.(option) ?? option.label ?? defaultLabel
      )}
      {inDrawer && selected && <Check className="size-4 shrink-0" />}
    </CommandItem>
  );
}

interface ISelectCommandListProps {
  inDrawer: boolean;
  search?: boolean | (() => void);
  placeholder?: string;
  notFoundText?: string;
  groupHeading?: string;
  filter?: (value: string, search: string) => number;
  shouldFilter: boolean;
  listRef: React.RefObject<HTMLDivElement>;
  highlighted: string | null;
  onHighlightedChange: (value: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onSearchValueChange: (value: string) => void;
  children: React.ReactNode;
}

/**
 * The option list, shared by the popover and the stacked drawer. Inside a
 * drawer it sheds the card treatment and its search box becomes the inset
 * field from the drawer list preset.
 */
function SelectCommandList(props: ISelectCommandListProps) {
  const {
    inDrawer,
    search,
    placeholder,
    notFoundText,
    groupHeading,
    filter,
    shouldFilter,
    listRef,
    highlighted,
    onHighlightedChange,
    onCompositionStart,
    onCompositionEnd,
    onSearchValueChange,
    children,
  } = props;

  return (
    <Command
      filter={filter}
      shouldFilter={shouldFilter}
      className={cn(inDrawer && 'h-full max-w-none rounded-none bg-transparent shadow-none')}
      {...(inDrawer ? { value: highlighted ?? undefined, onValueChange: onHighlightedChange } : {})}
    >
      {search ? (
        <CommandInput
          placeholder={placeholder}
          className={cn('placeholder:text-sm', inDrawer && 'h-8 text-sm')}
          containerClassName={cn(
            inDrawer && 'mx-4 mb-1 mt-4 h-8 shrink-0 gap-2 rounded-md border border-input px-3 py-0'
          )}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onValueChange={onSearchValueChange}
        />
      ) : null}
      <CommandEmpty>{notFoundText}</CommandEmpty>
      <CommandList ref={listRef} className={cn('mt-1', inDrawer && 'max-h-full flex-1 p-2')}>
        {groupHeading ? <CommandGroup heading={groupHeading}>{children}</CommandGroup> : children}
      </CommandList>
    </Command>
  );
}

function BaseSingleSelect<V extends string, O extends IOption<V> = IOption<V>>(
  props: IBaseSelect<V, O>
) {
  const [searchValue, setSearchValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);

  const { t } = useTranslation();
  const {
    onSelect,
    value,
    options,
    className,
    popoverClassName,
    placeholderClassName,
    disabled = false,
    optionRender,
    notFoundText = t('common.noRecords'),
    displayRender,
    search = true,
    onSearch,
    placeholder = t('common.search.placeholder'),
    cancelable = false,
    defaultLabel = t('common.untitled'),
    modal,
    groupHeading,
    drawerTitle,
  } = props;
  const inDrawer = useInDrawer();
  const [open, setOpen] = useState(false);
  // cmdk highlights whichever item matches `Command.value`. Seeding it with
  // the current selection means a screen reader announces the persisted
  // choice on open rather than the first option - which matters most for the
  // searchless lists (conjunction, sort order) where there is nothing else to
  // orient by.
  const [highlighted, setHighlighted] = useState<string | null>(value);
  const listRef = useRef<HTMLDivElement>(null);
  const popoverContentRef = useRef<HTMLDivElement>(null);

  const label = useMemo(() => {
    return options.find((option) => option.value === value)?.label || defaultLabel;
  }, [defaultLabel, options, value]);

  const selectedValue = useMemo(() => {
    return options.find((option) => option.value === value);
  }, [options, value]);

  const optionMap = useMemo(() => {
    const map: Record<string, string> = {};
    options.forEach((option) => {
      const key = option.value;
      const value = option.label;
      map[key] = value;
    });
    return map;
  }, [options]);

  const commandFilter = useCallback(
    (id: string, searchValue: string) => {
      const name = optionMap?.[id?.trim()]?.toLowerCase() || '';
      return name.includes(searchValue?.toLowerCase()?.trim()) ? 1 : 0;
    },
    [optionMap]
  );

  const setApplySearchDebounced = useMemo(() => {
    return onSearch ? debounce(onSearch, 200) : undefined;
  }, [onSearch]);

  useEffect(() => {
    if (!isComposing) {
      setApplySearchDebounced?.(searchValue);
    }
  }, [searchValue, isComposing, onSearch, setApplySearchDebounced]);

  useEffect(() => {
    const popoverContent = popoverContentRef.current;
    if (!open || !popoverContent) {
      return;
    }

    const handleWheel = (event: WheelEvent) => scrollListByWheel(event, listRef.current);
    popoverContent.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => popoverContent.removeEventListener('wheel', handleWheel, true);
  }, [open]);

  const renderOptions = () =>
    options?.map((option) => (
      <SelectOptionItem
        key={option.value}
        option={option}
        selected={value === option.value}
        inDrawer={inDrawer}
        defaultLabel={defaultLabel}
        optionRender={optionRender}
        onSelect={() => {
          // support re-select to reset selection when cancelable is enabled
          if (cancelable && value === option.value) {
            onSelect(null);
            setOpen(false);
            return;
          }
          onSelect(option.value);
          setOpen(false);
        }}
      />
    ));

  const trigger = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      disabled={disabled}
      className={cn(
        'justify-between truncate overflow-hidden px-3 font-normal',
        // Drawer defaults come BEFORE `className` so a caller that states its
        // own drawer width (FieldSelect, OperatorSelect) still wins the merge.
        inDrawer && 'h-9 w-full min-w-0 shrink',
        className,
        open && 'text-foreground'
      )}
    >
      {value ? (
        (selectedValue && displayRender?.(selectedValue)) ?? (
          <span className="truncate">{label}</span>
        )
      ) : (
        <span className={cn('text-sm font-normal text-muted-foreground', placeholderClassName)}>
          {t('common.selectPlaceHolder')}
        </span>
      )}
      <ChevronDown
        className={cn(
          'ms-2 size-4 shrink-0 text-muted-foreground transition-transform duration-200',
          open && 'rotate-180'
        )}
      />
    </Button>
  );

  const commandBody = (
    <SelectCommandList
      inDrawer={inDrawer}
      search={search}
      placeholder={placeholder}
      notFoundText={notFoundText}
      groupHeading={groupHeading}
      filter={onSearch ? undefined : commandFilter}
      shouldFilter={!onSearch}
      listRef={listRef}
      highlighted={highlighted}
      onHighlightedChange={setHighlighted}
      onCompositionStart={() => setIsComposing(true)}
      onCompositionEnd={() => setIsComposing(false)}
      onSearchValueChange={setSearchValue}
    >
      {renderOptions()}
    </SelectCommandList>
  );

  if (inDrawer) {
    return (
      <NestedDrawer
        open={open}
        onOpenChange={(next) => {
          // The drawer body remounts per open, but this component does not.
          // Re-seed from the current value so the highlight never lags behind
          // a value that changed while the drawer was closed.
          if (next) setHighlighted(value);
          setOpen(next);
        }}
        title={drawerTitle ?? t('common.selectPlaceHolder')}
        // A search box means the list can shrink to nothing while typing;
        // pin the height so the panel does not jump.
        size={search ? 'list' : 'auto'}
        content={commandBody}
      >
        {trigger}
      </NestedDrawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent ref={popoverContentRef} align="start" className={cn('p-1', popoverClassName)}>
        {commandBody}
      </PopoverContent>
    </Popover>
  );
}

BaseSingleSelect.displayName = 'BaseSingleSelect';

export { BaseSingleSelect };
