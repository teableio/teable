import { useRecords, AnchorProvider } from '@teable-group/sdk';
import type { LinkField } from '@teable-group/sdk';

import SelectIcon from '@teable-group/ui-lib/icons/app/select.svg';
import { Popover, PopoverTrigger, PopoverContent } from '@teable-group/ui-lib/shadcn';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable-group/ui-lib/shadcn/ui/command';

import classNames from 'classnames';
import { ChevronsUpDown } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import { FilterInput } from './FilterInput';

interface IFilterLinkProps {
  field: LinkField;
  operator: string;
  value: string[] | null;
  onSelect: (value: string[] | string | null) => void;
}

const inputOperators = ['contains', 'doesNotContain'];

const FilterLinkSelectBase = (props: IFilterLinkProps) => {
  const { value, onSelect, operator } = props;
  const [open, setOpen] = useState(false);
  const values = useMemo(() => {
    return value || [];
  }, [value]);
  const records = useRecords();
  const options = records.map(({ id, name }) => ({
    label: name,
    value: id,
  }));
  const shouldInput = useMemo(() => {
    return !inputOperators.includes(operator);
  }, [operator]);
  const selectHandler = (name: string) => {
    let newCellValue = null;
    const existIndex = values?.findIndex((item) => item === name) ?? -1;
    if (existIndex > -1) {
      newCellValue = values?.slice();
      newCellValue?.splice(existIndex, 1);
    } else {
      newCellValue = [...values, name];
    }
    onSelect?.(newCellValue);
  };
  const getName = useCallback(
    (value: string) => {
      return records.find((record) => record.id === value)?.name;
    },
    [records]
  );

  return (
    <>
      {shouldInput ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-32 max-w-[128px] justify-between m-1 overflow-hidden"
            >
              <div className="shrink whitespace-nowrap overflow-hidden flex">
                {Array.isArray(values) && values.length
                  ? values?.map((item, index) => (
                      <div key={index} className={classNames('px-2 rounded-lg m-1 bg-secondary')}>
                        {getName(item)}
                      </div>
                    ))
                  : 'Select'}
              </div>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px]">
            <Command className="rounded-sm">
              <CommandList>
                <CommandInput placeholder="Search option" />
                <CommandEmpty>No found.</CommandEmpty>
                <CommandGroup aria-valuetext="name">
                  {options.length ? (
                    options.map(({ label, value }) => (
                      <CommandItem key={label} value={label} onSelect={() => selectHandler(value)}>
                        <SelectIcon
                          className={classNames(
                            'mr-2 h-4 w-4',
                            values?.map((label) => label)?.includes(value)
                              ? 'opacity-100'
                              : 'opacity-0'
                          )}
                        />
                        <div className={classNames('px-2 rounded-lg')}>{label}</div>
                      </CommandItem>
                    ))
                  ) : (
                    <span className="text-sm text-gray-600">no result</span>
                  )}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <FilterInput placeholder="Enter a value" value={values} onChange={onSelect} />
      )}
    </>
  );
};

const FilterLinkSelect = (props: IFilterLinkProps) => {
  const tableId = props?.field?.options?.foreignTableId;
  return (
    <AnchorProvider tableId={tableId} fallback={<h1>Empty</h1>}>
      <FilterLinkSelectBase {...props} />
    </AnchorProvider>
  );
};

export { FilterLinkSelect };
