import type {
  IFormulaFieldOptions,
  ILookupOptionsRo,
  INumberShowAs,
  IUnionFormatting,
} from '@teable-group/core';
import { CellValueType } from '@teable-group/core';
import { useFields } from '@teable-group/sdk/hooks';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { FormulaField } from '@teable-group/sdk/model';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { keyBy } from 'lodash';
import { useMemo, useState } from 'react';
import { UnionFormatting } from '../formatting/UnionFormatting';
import { useIsMultipleCellValue } from '../hooks';
import { UnionShowAs } from '../show-as/UnionShowAs';

export const FormulaOptions = (props: {
  options: Partial<IFormulaFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  lookupField?: IFieldInstance;
  lookupOptions?: ILookupOptionsRo;
  onChange?: (options: Partial<IFormulaFieldOptions>) => void;
}) => {
  const { options = {}, isLookup, lookupField, lookupOptions, onChange } = props;
  const { formatting, expression } = options;
  const fields = useFields();
  const [errMsg, setErrMsg] = useState('');
  const [expressionByName, setExpressionByName] = useState<string>((): string => {
    return expression
      ? FormulaField.convertExpressionIdToName(expression, keyBy(fields, 'id'), true)
      : '';
  });

  const isLookupFieldMultiple = useIsMultipleCellValue(isLookup, lookupField, lookupOptions);

  const { cellValueType, isMultipleCellValue } = useMemo(() => {
    if (isLookup && lookupField) {
      return {
        cellValueType: lookupField.cellValueType,
        isMultipleCellValue: lookupField.isMultipleCellValue,
      };
    }
    const defaultResult = { cellValueType: CellValueType.String, isMultipleCellValue: false };
    try {
      return expression
        ? FormulaField.getParsedValueType(expression, keyBy(fields, 'id'))
        : defaultResult;
    } catch (e) {
      return defaultResult;
    }
  }, [expression, fields, isLookup, lookupField]);

  const onExpressionChange = (expressionByName: string) => {
    try {
      const expression = FormulaField.convertExpressionNameToId(
        expressionByName,
        keyBy(fields, 'id')
      );
      onChange?.({
        expression,
      });
      setExpressionByName(expressionByName);
      setErrMsg('');
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setErrMsg((e as any).message);
      setExpressionByName(expressionByName);
    }
  };

  const onFormattingChange = (value?: IUnionFormatting) => {
    const formatting = value;
    if (isLookup) {
      return onChange?.({
        formatting,
        expression: (lookupField?.options as IFormulaFieldOptions)?.expression ?? expression,
      });
    }
    onChange?.({ formatting });
  };

  const onShowAsChange = (value?: INumberShowAs) => {
    if (isLookup) {
      return onChange?.({
        showAs: value,
        expression: (lookupField?.options as IFormulaFieldOptions)?.expression ?? expression,
      });
    }
    onChange?.({ showAs: value });
  };

  return (
    <div className="w-full space-y-2">
      {!isLookup && (
        <div className="space-y-2">
          <span className="neutral-content label-text">Formula</span>
          <Input
            type="text"
            className="h-8"
            value={expressionByName}
            onChange={(e) => onExpressionChange(e.target.value)}
          />
          {errMsg && <span className="neutral-content label-text">{errMsg}</span>}
        </div>
      )}
      {!errMsg && (
        <div className="space-y-2">
          <UnionFormatting
            cellValueType={cellValueType}
            formatting={formatting}
            onChange={onFormattingChange}
          />
        </div>
      )}
      {!errMsg && (
        <div className="space-y-2">
          <UnionShowAs
            showAs={options?.showAs}
            cellValueType={cellValueType}
            isMultipleCellValue={isMultipleCellValue || isLookupFieldMultiple}
            onChange={onShowAsChange}
          />
        </div>
      )}
    </div>
  );
};
