import type { MultipleSelectFieldCore } from '@teable-group/core';
import { ColorUtils } from '@teable-group/core';
import { useFields } from '@teable-group/sdk';
import SelectIcon from '@teable-group/ui-lib/icons/app/select.svg';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable-group/ui-lib/shadcn/ui/command';
import classNames from 'classnames';
import { useMemo } from 'react';

interface IMutipleSelector {
  onSelect?: (names: string[]) => void;
  value: unknown;
  fieldId?: string;
}

const MultipleSelector = (props: IMutipleSelector) => {
  const fields = useFields();
  const { fieldId, value } = props;
  const choices = useMemo(() => {
    const curColumn = fields.find((item) => item.id === fieldId) as MultipleSelectFieldCore;
    return curColumn?.options?.choices;
  }, [fieldId, fields]);

  const onSelect = () => {
    // let newCellValue = null;
    // const existIndex = values.findIndex((item) => item === v);
    // if (existIndex > -1) {
    //   newCellValue = values.slice();
    //   newCellValue.splice(existIndex, 1);
    // } else {
    //   newCellValue = [...values, v];
    // }
    // if (field.type === FieldType.MultipleSelect) {
    // }
  };

  return (
    <Command className="rounded-sm shadow-sm p-2 border">
      <CommandList>
        <CommandInput placeholder="Search option" />
        <CommandEmpty>No found.</CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {choices.map(({ color, name }) => (
            <CommandItem key={name} value={name} onSelect={() => onSelect(name)}>
              <SelectIcon
                className={classNames(
                  'mr-2 h-4 w-4',
                  value?.includes(name) ? 'opacity-100' : 'opacity-0'
                )}
              />
              <div
                className={classNames('px-2 rounded-lg')}
                style={{
                  backgroundColor: ColorUtils.getHexForColor(color),
                  color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
                }}
              >
                {name}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
};

MultipleSelector.displayName = 'MultipleSelector';

export { MultipleSelector };
