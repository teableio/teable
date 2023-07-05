import type { IFormulaFieldOptions, IFormulaFormatting } from '@teable-group/core';
import { CellValueType } from '@teable-group/core';
import { useFields } from '@teable-group/sdk/hooks';
import { FormulaField } from '@teable-group/sdk/model';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { keyBy } from 'lodash';
import { useMemo, useState } from 'react';
import { DatetimeFormatting } from '../formatting/DatetimeFormatting';
import { NumberFormatting } from '../formatting/NumberFormatting';

export const FormulaFormatting = (props: {
  cellValueType: string;
  formatting?: IFormulaFormatting;
  onChange?: (formatting: IFormulaFormatting) => void;
}) => {
  const { cellValueType, formatting, onChange } = props;

  const FormattingComponent = useMemo(
    function getFormattingComponent() {
      switch (cellValueType) {
        case CellValueType.DateTime:
          return DatetimeFormatting;
        case CellValueType.Number:
          return NumberFormatting;
        default:
          return null;
      }
    },
    [cellValueType]
  );
  if (!FormattingComponent) {
    return <></>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <FormattingComponent formatting={formatting as any} onChange={onChange} />;
};

export const FormulaOptions = (props: {
  options: IFormulaFieldOptions;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  onChange?: (options: IFormulaFieldOptions) => void;
}) => {
  const { options, isLookup, cellValueType: privateCellValueType, onChange } = props;
  const { formatting, expression } = options;
  const fields = useFields();
  const [errMsg, setErrMsg] = useState('');
  const [expressionByName, setExpressionByName] = useState<string>((): string => {
    return expression
      ? FormulaField.convertExpressionIdToName(expression, keyBy(fields, 'id'))
      : '';
  });

  const cellValueType = useMemo(() => {
    return privateCellValueType || expression
      ? FormulaField.getParsedValueType(expression, keyBy(fields, 'id')).cellValueType
      : CellValueType.String;
  }, [expression, fields, privateCellValueType]);

  const onExpressionChange = (expressionByName: string) => {
    try {
      const expression = FormulaField.convertExpressionNameToId(
        expressionByName,
        keyBy(fields, 'id')
      );
      onChange?.({
        expression,
        formatting,
      });
      setExpressionByName(expressionByName);
      setErrMsg('');
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setErrMsg((e as any).message);
      setExpressionByName(expressionByName);
    }
  };

  const onFormattingChange = (value?: IFormulaFormatting) => {
    const formatting = value;
    onChange?.({ expression, formatting });
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
          <FormulaFormatting
            cellValueType={cellValueType}
            formatting={formatting}
            onChange={onFormattingChange}
          />
        </div>
      )}
    </div>
  );
};
