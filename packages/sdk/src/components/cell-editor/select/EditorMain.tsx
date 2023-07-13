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
import { selectOnChange } from '../utils';
import { SelectTag } from './SelectTag';

export type ISelectEditorMain = {
  value?: string[];
  options?: {
    label: string;
    value: string;
    color?: string;
    backgroundColor?: string;
  }[];
  isMultiple?: boolean;
  onChange?: (value: string[]) => void;
  style?: React.CSSProperties;
  className?: string;
};

export const SelectEditorMain = (props: ISelectEditorMain) => {
  const { value: originValue = [], options = [], isMultiple, onChange, style, className } = props;
  const onSelect = (val: string) => {
    const newValue = selectOnChange(val, originValue, isMultiple);
    onChange?.(newValue);
  };

  return (
    <Command className={classNames('rounded-sm shadow-sm p-2 border', className)} style={style}>
      <CommandList>
        <CommandInput placeholder="Search option" />
        <CommandEmpty>No found.</CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {options.map(({ label, value, backgroundColor, color }) => (
            <CommandItem key={value} value={value} onSelect={() => onSelect(value)}>
              <Check
                className={classNames(
                  'mr-2 h-4 w-4',
                  originValue?.includes(value) ? 'opacity-100' : 'opacity-0'
                )}
              />
              <SelectTag label={label} backgroundColor={backgroundColor} color={color} />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
};
