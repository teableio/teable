import type { NumberFieldOptions as NumberFieldOptionsType } from '@teable-group/core';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NUMBER_FIELD_PRECISION } from '../../utils/field';

export const NumberOptions = (props: {
  options: NumberFieldOptionsType;
  onChange?: (options: NumberFieldOptionsType) => void;
}) => {
  const { options, onChange } = props;
  const precision = options.precision || 0;

  const onPrecisionChange = (value: string) => {
    const precision = Number(value) || 0;
    onChange?.({ precision });
  };

  return (
    <div className="form-control w-full">
      <div className="label">
        <span className="neutral-content label-text mb-2">Precision</span>
      </div>
      <Select value={precision.toString()} onValueChange={onPrecisionChange}>
        <SelectTrigger className="w-full h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {NUMBER_FIELD_PRECISION.map(({ text, value }) => (
            <SelectItem key={value} value={value.toString()}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
