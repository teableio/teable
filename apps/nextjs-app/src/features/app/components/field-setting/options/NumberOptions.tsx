import type { INumberShowAs, INumberFormatting, INumberFieldOptions } from '@teable/core';
import { NumberFormatting } from '../formatting/NumberFormatting';
import { MultiNumberShowAs } from '../show-as/MultiNumberShowAs';
import { SingleNumberShowAs } from '../show-as/SingleNumberShowAs';

export const NumberOptions = (props: {
  options: Partial<INumberFieldOptions> | undefined;
  isLookup?: boolean;
  isMultipleCellValue?: boolean;
  onChange?: (options: Partial<INumberFieldOptions>) => void;
}) => {
  const { options, isMultipleCellValue, onChange } = props;

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

  return (
    <div className="form-control space-y-2">
      <NumberFormatting formatting={options?.formatting} onChange={onFormattingChange} />
      <ShowAsComponent showAs={options?.showAs as never} onChange={onShowAsChange} />
    </div>
  );
};
