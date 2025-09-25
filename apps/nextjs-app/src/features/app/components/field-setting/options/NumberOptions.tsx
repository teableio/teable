import type { INumberShowAs, INumberFormatting, INumberFieldOptions } from '@teable/core';
import { Input } from '@teable/ui-lib/shadcn';
import { DefaultValue } from '../DefaultValue';
import { NumberFormatting } from '../formatting/NumberFormatting';
import { MultiNumberShowAs } from '../show-as/MultiNumberShowAs';
import { SingleNumberShowAs } from '../show-as/SingleNumberShowAs';

export const NumberOptions = (props: {
  options: Partial<INumberFieldOptions> | undefined;
  isLookup?: boolean;
  isMultipleCellValue?: boolean;
  onChange?: (options: Partial<INumberFieldOptions>) => void;
}) => {
  const { isLookup, options, isMultipleCellValue, onChange } = props;

  const ShowAsComponent = isMultipleCellValue ? MultiNumberShowAs : SingleNumberShowAs;

  const onFormattingChange = (formatting: INumberFormatting) => {
    onChange?.({
      formatting,
    });
  };

  const onShowAsChange = (showAs?: INumberShowAs) => {
    onChange?.({
      showAs,
    });
  };

  const onDefaultValueChange = (defaultValue: number | undefined) => {
    onChange?.({
      defaultValue,
    });
  };

  return (
    <div className="form-control space-y-4">
      <NumberFormatting formatting={options?.formatting} onChange={onFormattingChange} />
      <hr />
      {!isLookup && (
        <DefaultValue onReset={() => onDefaultValueChange(undefined)}>
          <Input
            type="number"
            value={options?.defaultValue !== undefined ? options.defaultValue : ''}
            onChange={(e) => {
              const value = e.target.value;
              onDefaultValueChange(value === '' ? undefined : Number(value));
            }}
          />
        </DefaultValue>
      )}
      <ShowAsComponent showAs={options?.showAs as never} onChange={onShowAsChange} />
    </div>
  );
};
