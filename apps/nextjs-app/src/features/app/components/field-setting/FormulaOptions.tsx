import type { FormulaFieldOptions, IFormulaFormatting } from '@teable-group/core';
import { useFields } from '@teable-group/sdk/hooks';
import { FormulaField, NumberField } from '@teable-group/sdk/model';
import { keyBy } from 'lodash';
import { useState } from 'react';
import { NumberOptions } from './NumberOptions';

export const FormulaOptions = (props: {
  options: FormulaFieldOptions;
  onChange?: (options: FormulaFieldOptions) => void;
}) => {
  const { options, onChange } = props;
  const { formatting, expression = '' } = options;
  const fields = useFields();
  const [expressionByName, setExpressionByName] = useState<string>((): string => {
    return FormulaField.convertExpressionIdToName(expression, keyBy(fields, 'id'));
  });

  const onExpressionChange = (value: string) => {
    const expressionByName = value;
    onChange?.({
      expression: FormulaField.convertExpressionNameToId(expressionByName, keyBy(fields, 'id')),
      formatting,
    });
    setExpressionByName(expressionByName);
  };

  const onFormattingChange = (value?: IFormulaFormatting) => {
    const formatting = value;
    onChange?.({ expression, formatting });
  };

  return (
    <div className="form-control w-full">
      <div className="label">
        <span className="neutral-content label-text mb-2">Formula</span>
      </div>
      <input
        type="text"
        className="input input-bordered w-full input-sm"
        value={expressionByName}
        onChange={(e) => onExpressionChange(e.target.value)}
      />
      <div className="label">
        <span className="neutral-content label-text mb-2">Formatting</span>
      </div>
      <NumberOptions
        options={formatting || NumberField.defaultOptions()}
        onChange={onFormattingChange}
      />
    </div>
  );
};
