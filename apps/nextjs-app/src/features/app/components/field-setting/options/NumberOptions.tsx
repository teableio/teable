import type { INumberFieldOptions, INumberFormatting } from '@teable-group/core';
import { NumberFormatting } from '../formatting/NumberFormatting';

export const NumberOptions = (props: {
  options?: INumberFieldOptions;
  isLookup?: boolean;
  onChange?: (options: INumberFieldOptions) => void;
}) => {
  const { onChange } = props;

  const onFormattingChange = (formatting: INumberFormatting) => {
    onChange?.({
      formatting,
    });
  };

  return (
    <div className="form-control">
      <NumberFormatting onChange={onFormattingChange} />
    </div>
  );
};
