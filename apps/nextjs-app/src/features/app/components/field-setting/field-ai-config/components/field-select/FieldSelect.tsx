import type { FieldType } from '@teable/core';
import { Check, ChevronDown } from '@teable/icons';
import { useFields, useFieldStaticGetter } from '@teable/sdk/hooks';
import {
  cn,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface IFieldSelectProps {
  selectedId?: string;
  excludedIds?: string[];
  excludeTypes?: FieldType[];
  disabledTypes?: FieldType[];
  disabledReason?: string;
  onChange: (fieldId: string) => void;
}

export const FieldSelect: React.FC<IFieldSelectProps> = (props) => {
  const {
    selectedId,
    excludeTypes = [],
    excludedIds = [],
    disabledTypes = [],
    disabledReason,
    onChange,
  } = props;
  const fields = useFields({ withHidden: true, withDenied: true });
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const getFieldStatic = useFieldStaticGetter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const candidates = useMemo(() => {
    return fields
      .filter((f) => !excludeTypes.includes(f.type) && !excludedIds.includes(f.id))
      .map((f) => {
        const Icon = getFieldStatic(f.type, {
          isLookup: f.isLookup,
          isConditionalLookup: f.isConditionalLookup,
          hasAiConfig: Boolean(f.aiConfig),
          deniedReadRecord: !f.canReadFieldRecord,
        }).Icon;
        return {
          id: f.id,
          name: f.name,
          type: f.type,
          icon: <Icon className="size-4 shrink-0" />,
          disabled: disabledTypes.includes(f.type),
        };
      });
  }, [fields, excludeTypes, excludedIds, disabledTypes, getFieldStatic]);

  const candidatesMap = useMemo(
    () =>
      candidates.reduce(
        (pre, cur) => {
          pre[cur.id] = cur;
          return pre;
        },
        {} as Record<string, (typeof candidates)[0]>
      ),
    [candidates]
  );

  const selected = candidatesMap[selectedId || ''];

  const renderItem = (item: (typeof candidates)[0]) => {
    const { id, name, icon, disabled } = item;
    const isSelected = id === selectedId;

    const itemContent = (
      <CommandItem
        key={id}
        value={id}
        disabled={disabled}
        onSelect={() => {
          if (disabled) return;
          onChange(id);
          setOpen(false);
        }}
        className={cn('flex', disabled && 'pointer-events-none opacity-50')}
      >
        <Check
          className={cn('mr-2 h-4 w-4 flex-shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
        />
        {icon}
        <span className="ml-2 truncate">{name}</span>
      </CommandItem>
    );

    if (disabled && disabledReason) {
      return (
        <TooltipProvider key={id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>{itemContent}</div>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p className="max-w-[200px] text-xs">{disabledReason}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return itemContent;
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          disabled={!candidates.length}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('flex gap-2 font-normal px-3 w-full')}
        >
          {selected ? (
            <>
              {selected.icon}
              <span className="truncate">{selected.name}</span>
            </>
          ) : (
            <span className="shrink-0">{t('table:field.editor.selectField')}</span>
          )}
          <div className="grow"></div>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-full max-w-[200px] p-0"
        style={{ minWidth: ref.current?.offsetWidth }}
      >
        <Command
          filter={(value, search) => {
            if (!search) return 1;
            const item = candidatesMap[value];
            const text = item?.name || item?.id;
            if (text?.toLocaleLowerCase().includes(search.toLocaleLowerCase())) return 1;
            return 0;
          }}
        >
          <CommandInput placeholder={t('sdk:common.search.placeholder')} />
          <CommandEmpty>{t('sdk:common.search.empty')}</CommandEmpty>
          <CommandList>{candidates.map(renderItem)}</CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
