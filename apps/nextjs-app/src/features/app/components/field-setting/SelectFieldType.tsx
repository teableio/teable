import { FieldType, PRIMARY_SUPPORTED_TYPES } from '@teable/core';
import { FIELD_TYPE_ORDER, useFieldStaticGetter } from '@teable/sdk';
import SearchIcon from '@teable/ui-lib/icons/app/search.svg';
import {
  Button,
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

type InnerFieldType = FieldType | 'lookup';

interface ISelectorItem {
  id: InnerFieldType;
  name: string;
  icon?: React.ReactNode;
}

export const FIELD_TYPE_ORDER1 = [
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultipleSelect,
  FieldType.User,
  FieldType.Date,
  FieldType.Rating,
  FieldType.Checkbox,
  FieldType.Attachment,
  FieldType.Formula,
  FieldType.Link,
  FieldType.Rollup,
  FieldType.Button,
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
  FieldType.AutoNumber,
];

const BASE_FIELD_TYPE = [
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultipleSelect,
  FieldType.User,
  FieldType.Date,
  FieldType.Rating,
  FieldType.Checkbox,
  FieldType.Attachment,
];

const ADVANCED_FIELD_TYPE_ORDER = [
  FieldType.Formula,
  FieldType.Link,
  FieldType.Rollup,
  FieldType.Button,
  FieldType.AutoNumber,
];

const SYSTEM_FIELD_TYPE_ORDER = [
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
];

const fieldTypeItem = (
  item: ISelectorItem,
  value: InnerFieldType,
  setOpen: (open: boolean) => void,
  onChange?: (type: InnerFieldType) => void
) => {
  const { id, name, icon } = item;
  return (
    <CommandItem
      key={id}
      value={id}
      onSelect={() => {
        onChange?.(id);
        setOpen(false);
      }}
      title={name}
      className="flex min-w-0 items-center gap-2"
    >
      <Check className={cn('h-4 w-4 flex-shrink-0', id === value ? 'opacity-100' : 'opacity-0')} />
      {icon}
      <span className={cn('truncate flex-1', name ? '' : 'text-primary/60')}>{name}</span>
    </CommandItem>
  );
};

export const SelectFieldType = (props: {
  isPrimary?: boolean;
  value?: InnerFieldType;
  onChange?: (type: InnerFieldType) => void;
}) => {
  const { isPrimary, value = FieldType.SingleLineText, onChange } = props;
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const searchTip = t('actions.search');
  const emptyTip = t('noResult');

  const baseGroup = useMemo((): ISelectorItem[] => {
    const fieldTypes = isPrimary
      ? BASE_FIELD_TYPE.filter((type) => PRIMARY_SUPPORTED_TYPES.has(type))
      : BASE_FIELD_TYPE;
    return fieldTypes.map((type) => {
      const { title, Icon } = getFieldStatic(type, {
        isLookup: false,
        hasAiConfig: false,
      });
      return {
        id: type,
        name: title,
        icon: <Icon className="size-4" />,
      };
    });
  }, [getFieldStatic, isPrimary]);

  const advancedGroup = useMemo((): ISelectorItem[] => {
    const fieldTypes = isPrimary
      ? ADVANCED_FIELD_TYPE_ORDER.filter((type) => PRIMARY_SUPPORTED_TYPES.has(type))
      : ADVANCED_FIELD_TYPE_ORDER;
    const list: ISelectorItem[] = fieldTypes.map((type) => {
      const { title, Icon } = getFieldStatic(type, {
        isLookup: false,
        hasAiConfig: false,
      });
      return {
        id: type,
        name: title,
        icon: <Icon className="size-4" />,
      };
    });
    if (!isPrimary) {
      list.push({
        id: 'lookup',
        name: t('sdk:field.title.lookup'),
        icon: <SearchIcon className="size-4" />,
      });
    }
    return list;
  }, [getFieldStatic, isPrimary, t]);

  const systemGroup = useMemo((): ISelectorItem[] => {
    const fieldTypes = isPrimary
      ? SYSTEM_FIELD_TYPE_ORDER.filter((type) => PRIMARY_SUPPORTED_TYPES.has(type))
      : SYSTEM_FIELD_TYPE_ORDER;
    return fieldTypes.map((type) => {
      const { title, Icon } = getFieldStatic(type, {
        isLookup: false,
        hasAiConfig: false,
      });
      return {
        id: type,
        name: title,
        icon: <Icon className="size-4" />,
      };
    });
  }, [getFieldStatic, isPrimary]);

  const candidates = useMemo((): ISelectorItem[] => {
    const fieldTypes = isPrimary
      ? FIELD_TYPE_ORDER.filter((type) => PRIMARY_SUPPORTED_TYPES.has(type))
      : FIELD_TYPE_ORDER;
    const result = fieldTypes.map<ISelectorItem>((type) => {
      const { title, Icon } = getFieldStatic(type, {
        isLookup: false,
        hasAiConfig: false,
      });
      return {
        id: type,
        name: title,
        icon: <Icon className="size-4" />,
      };
    });

    return isPrimary
      ? result
      : result.concat({
          id: 'lookup',
          name: t('sdk:field.title.lookup'),
          icon: <SearchIcon className="size-4" />,
        });
  }, [getFieldStatic, t, isPrimary]);

  const candidatesMap = useMemo(
    () =>
      candidates.reduce(
        (pre, cur) => {
          pre[cur.id] = cur;
          return pre;
        },
        {} as Record<string, ISelectorItem>
      ),
    [candidates]
  );
  const selected = candidatesMap[value];

  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('flex gap-1 font-normal px-3')}
        >
          {selected.icon}
          <span className="truncate">{selected.name}</span>
          <div className="grow"></div>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-96 p-0', 'select-field-type')}>
        <Command
          filter={(value, search) => {
            if (!search) return 1;
            const item = candidatesMap[value];
            const text = item?.name || item?.id;
            if (text?.toLocaleLowerCase().includes(search.toLocaleLowerCase())) return 1;
            return 0;
          }}
        >
          <CommandInput placeholder={searchTip} />
          <CommandEmpty>{emptyTip}</CommandEmpty>
          <CommandList>
            <CommandGroup className="border-b border-border">
              <div className="grid grid-cols-2 gap-1">
                {baseGroup.map((item) => fieldTypeItem(item, value, setOpen, onChange))}
              </div>
            </CommandGroup>
            <CommandGroup className="border-b border-border">
              <div className="grid grid-cols-2 gap-1">
                {advancedGroup.map((item) => fieldTypeItem(item, value, setOpen, onChange))}
              </div>
            </CommandGroup>
            <CommandGroup>
              <div className="grid grid-cols-2 gap-1">
                {systemGroup.map((item) => fieldTypeItem(item, value, setOpen, onChange))}
              </div>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
