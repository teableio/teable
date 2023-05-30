import type { NumberFieldOptions as NumberFieldOptionsType } from '@teable-group/core';
import { Select } from 'antd';
import { NUMBER_FIELD_PRECISION } from '../../utils/field';

const { Option } = Select;

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
      <Select value={precision.toString()} onChange={onPrecisionChange}>
        {NUMBER_FIELD_PRECISION.map(({ text, value }) => (
          <Option key={value} value={value.toString()}>
            {text}
          </Option>
        ))}
      </Select>
    </div>
  );
};
