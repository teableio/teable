import type { INumberFieldOptions, INumberFormatting } from '@teable-group/core';
import { NumberFormatting } from '../formatting/NumberFormatting';

export const NumberOptions = (props: {
  options: Partial<INumberFieldOptions> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<INumberFieldOptions>) => void;
}) => {
  const { options, onChange } = props;

  const onFormattingChange = (formatting: INumberFormatting) => {
    onChange?.({
      formatting,
    });
  };

  return (
    <div className="form-control">
      <NumberFormatting formatting={options?.formatting} onChange={onFormattingChange} />
    </div>
  );
};
