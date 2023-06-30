import type { FormulaFieldOptions, IFormulaFormatting } from '@teable-group/core';
import { useFields } from '@teable-group/sdk/hooks';
import { FormulaField, NumberField } from '@teable-group/sdk/model';
import { keyBy } from 'lodash';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { NumberOptions } from './NumberOptions';

export const FormulaOptions = (props: {
  options: FormulaFieldOptions;
  isLookup?: boolean;
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
    <div className="w-full space-y-2">
      <div className="space-y-2">
        <span className="neutral-content label-text mb-2">Formula</span>
        <Input
          type="text"
          className="h-8"
          value={expressionByName}
          onChange={(e) => onExpressionChange(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <span className="neutral-content label-text mb-2">Formatting</span>
        <NumberOptions
          options={formatting || NumberField.defaultOptions()}
          onChange={onFormattingChange}
        />
      </div>
    </div>
  );
};
