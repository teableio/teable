import { FieldType } from '@teable/core';
import type { SortFunc } from '@teable/core';
import { Checked, ChevronDown, Square } from '@teable/icons';
import {
  Button,
  Select,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectContent,
  SelectItem,
  cn,
} from '@teable/ui-lib';
import { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useFields } from '../../hooks';
import { supportsPinyinSort } from '../../utils/sort';
import { AdaptiveSelect } from '../adaptive-panel';

interface IOrderProps {
  value: SortFunc;
  fieldId: string;
  onSelect: (value: SortFunc, collation?: 'zh-pinyin') => void;
  triggerClassName?: string;
  collation?: 'zh-pinyin';
  enablePinyin?: boolean;
}

function OrderSelect(props: Readonly<IOrderProps>) {
  const { value, onSelect, fieldId, triggerClassName, collation, enablePinyin = false } = props;
  const { t } = useTranslation();

  const fields = useFields({ withHidden: true, withDenied: true });

  const field = useMemo(() => {
    return fields.find((field) => field.id === fieldId);
  }, [fieldId, fields]);

  const options = useMemo(() => {
    const cellValueType = field?.cellValueType;
    const fieldType = field?.type;

    const DEFAULTOPTIONS = [
      {
        value: 'asc',
        label: 'A → Z',
      },
      {
        value: 'desc',
        label: 'Z → A',
      },
    ];

    const NUMBEROPTIONS = [
      {
        value: 'asc',
        label: '1 → 9',
      },
      {
        value: 'desc',
        label: '9 → 1',
      },
    ];

    const SELECTOPTIONS = [
      {
        value: 'asc',
        label: t('sort.selectASCLabel'),
      },
      {
        value: 'desc',
        label: t('sort.selectDESCLabel'),
      },
    ];

    const CHECKBOXOPTIONS = [
      {
        value: 'asc',
        label: (
          <div className="flex items-center">
            <Square className="w-4 py-px" />
            <span className="px-1">→</span>
            <Checked className="w-4" />
          </div>
        ),
      },
      {
        value: 'desc',
        label: (
          <div className="flex items-center">
            <Checked className="w-4" />
            <span className="px-1">→</span>
            <Square className="w-4 py-px" />
          </div>
        ),
      },
    ];

    let option;

    switch (cellValueType) {
      case 'string':
        option = DEFAULTOPTIONS;
        break;
      case 'number':
      case 'dateTime':
        option = NUMBEROPTIONS;
        break;
      case 'boolean':
        option = CHECKBOXOPTIONS;
        break;
      default:
        option = DEFAULTOPTIONS;
        break;
    }

    /**
     * for select type
     * sort should sort by option's order
     */
    if (fieldType === FieldType.SingleSelect || fieldType === FieldType.MultipleSelect) {
      option = SELECTOPTIONS;
    }
    if (fieldType === FieldType.Button) {
      option = NUMBEROPTIONS;
    }

    const baseOptions = option || DEFAULTOPTIONS;
    return enablePinyin && supportsPinyinSort(field)
      ? [
          ...baseOptions,
          { value: 'pinyin-asc', label: t('sort.pinyinASCLabel') },
          { value: 'pinyin-desc', label: t('sort.pinyinDESCLabel') },
        ]
      : baseOptions;
  }, [field, enablePinyin, t]);

  const selectedValue = collation === 'zh-pinyin' && enablePinyin ? `pinyin-${value}` : value;
  const selectedLabel = options.find((option) => option.value === selectedValue)?.label;
  const handleSelect = (next: string) => {
    const isPinyin = next.startsWith('pinyin-');
    onSelect(
      (isPinyin ? next.slice('pinyin-'.length) : next) as SortFunc,
      isPinyin ? 'zh-pinyin' : undefined
    );
  };

  return (
    <AdaptiveSelect
      title={t('sort.orderTitle')}
      options={options.map((option) => ({ value: option.value, label: option.label }))}
      value={selectedValue}
      onSelect={handleSelect}
      // No search: let the panel be as tall as its content.
      size="auto"
      desktop={
        <Select value={selectedValue} onValueChange={handleSelect}>
          <SelectTrigger
            aria-label={t('sort.orderTitle')}
            className={cn(
              'mx-2 w-32',
              enablePinyin && supportsPinyinSort(field) && 'w-48',
              triggerClassName
            )}
          >
            <SelectValue placeholder={t('common.selectPlaceHolder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option, index) => (
                <SelectItem value={option.value} key={index}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      }
      trigger={
        <Button
          variant="outline"
          role="combobox"
          aria-label={t('sort.orderTitle')}
          className={cn(
            // Shares the row with the field selector rather than reserving a
            // fixed 128px: at 320px a fixed order button leaves the field name
            // about two characters wide.
            'h-9 w-auto min-w-24 max-w-32 flex-1 justify-between px-3 font-normal',
            enablePinyin && supportsPinyinSort(field) && 'max-w-48',
            triggerClassName
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      }
    />
  );
}

export { OrderSelect };
