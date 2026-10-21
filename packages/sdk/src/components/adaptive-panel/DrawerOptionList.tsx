import { Check } from '@teable/icons';
import { cn, Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@teable/ui-lib';
import { useMemo, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';

export interface IDrawerOption {
  value: string;
  label: React.ReactNode;
  /** Search text, required when `label` is not a plain string. */
  keywords?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface IDrawerOptionListProps {
  options: IDrawerOption[];
  /** Current value(s). Drives the trailing check mark and the initial highlight. */
  value?: string | string[] | null;
  onSelect: (value: string) => void;
  search?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  listClassName?: string;
}

const toArray = (value?: string | string[] | null) => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

/**
 * The option-list body shared by every drawer that presents a list of
 * choices. Deliberately sheds the popover card treatment (no rounding, no
 * shadow, no max width) so the list reads as part of the drawer.
 */
export const DrawerOptionList = (props: IDrawerOptionListProps) => {
  const {
    options,
    value,
    onSelect,
    search,
    searchPlaceholder,
    emptyText,
    className,
    listClassName,
  } = props;
  const { t } = useTranslation();

  const selected = useMemo(() => new Set(toArray(value)), [value]);

  // cmdk highlights the item matching `Command.value`. Seeding it with the
  // current value means a screen reader announces the persisted choice on
  // open instead of the first option in the list.
  const [highlighted, setHighlighted] = useState(() => toArray(value)[0] ?? '');

  return (
    <Command
      value={highlighted}
      onValueChange={setHighlighted}
      className={cn('h-full max-w-none rounded-none bg-transparent shadow-none', className)}
      // Options carry their own search text; cmdk's fuzzy scoring would
      // reorder fields the user is used to seeing in view order.
      filter={(itemValue, searchValue, keywords) => {
        const haystack = [itemValue, ...(keywords ?? [])].join(' ').toLowerCase();
        return haystack.includes(searchValue.toLowerCase()) ? 1 : 0;
      }}
    >
      {search && (
        <CommandInput
          placeholder={searchPlaceholder ?? t('common.search.placeholder')}
          containerClassName="mx-4 mb-1 mt-4 h-8 shrink-0 gap-2 rounded-md border border-input px-3 py-0"
          className="h-8 text-sm"
        />
      )}
      <CommandList className={cn('max-h-full flex-1 overflow-y-auto p-2', listClassName)}>
        <CommandEmpty>{emptyText ?? t('common.search.empty')}</CommandEmpty>
        {options.map((option) => {
          const isSelected = selected.has(option.value);
          return (
            <CommandItem
              key={option.value}
              value={option.value}
              keywords={[
                option.keywords,
                // Values are ids; without the label in the haystack a search
                // box over these options would match nothing.
                typeof option.label === 'string' ? option.label : undefined,
              ].filter((keyword): keyword is string => Boolean(keyword))}
              disabled={option.disabled}
              onSelect={() => onSelect(option.value)}
              className={cn(
                'h-9 gap-2 rounded-md px-3 text-sm',
                isSelected && 'bg-accent text-accent-foreground'
              )}
            >
              {option.icon}
              <span className="flex-1 truncate">{option.label}</span>
              {/* Trailing check: the mobile convention here is the mirror of
                  the desktop menus, where the mark leads the row. */}
              {isSelected && <Check className="size-4 shrink-0" />}
            </CommandItem>
          );
        })}
      </CommandList>
    </Command>
  );
};
