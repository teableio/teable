import { Check } from '@teable-group/icons';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useCallback } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import type { ICellEditor } from '../type';
import { SelectTag } from './SelectTag';

export type ISelectValue<T extends boolean> = T extends true ? string[] : string;

export interface ISelectEditorMain<T extends boolean> extends ICellEditor<ISelectValue<T>> {
  options?: {
    label: string;
    value: string;
    color?: string;
    backgroundColor?: string;
  }[];
  isMultiple?: T;
  style?: React.CSSProperties;
  className?: string;
}

export function SelectEditorMain<T extends boolean = false>(props: ISelectEditorMain<T>) {
  const { value: originValue, options = [], isMultiple, onChange, style, className } = props;
  const { t } = useTranslation();

  const onSelect = (val: string) => {
    if (isMultiple === true) {
      const innerValue = (originValue || []) as string[];
      const newValue = innerValue?.includes(val)
        ? innerValue.filter((v) => v !== val)
        : innerValue.concat(val);
      onChange?.(newValue as ISelectValue<T>);
      return;
    }
    onChange?.(val === originValue ? undefined : (val as ISelectValue<T>));
  };

  const activeStatus = useCallback(
    (value: string) => {
      return isMultiple ? originValue?.includes(value) : originValue === value;
    },
    [isMultiple, originValue]
  );

  return (
    <Command className={className} style={style}>
      <CommandInput placeholder="Search option" />
      <CommandList>
        <CommandEmpty>{t('common.search.empty')}</CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {options.map(({ label, value, backgroundColor, color }) => (
            <CommandItem key={value} value={value} onSelect={() => onSelect(value)}>
              <Check
                className={classNames(
                  'mr-2 h-4 w-4',
                  activeStatus(value) ? 'opacity-100' : 'opacity-0'
                )}
              />
              <SelectTag
                label={label || 'Untitled'}
                backgroundColor={backgroundColor}
                color={color}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
