import type { IFormulaFieldOptions, IUnionFormatting, IUnionShowAs } from '@teable/core';
import {
  CellValueType,
  getShowAsSchema,
  getFormattingSchema,
  getDefaultFormatting,
} from '@teable/core';
import { FormulaEditor } from '@teable/sdk/components';
import { useFields } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { FormulaField } from '@teable/sdk/model';
import { Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { isEmpty, isEqual, keyBy } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { useAI } from '@/features/app/hooks/useAI';
import { TimeZoneFormatting } from '../formatting/TimeZoneFormatting';
import { UnionFormatting } from '../formatting/UnionFormatting';
import { UnionShowAs } from '../show-as/UnionShowAs';

const calculateTypedValue = (fields: IFieldInstance[], expression?: string) => {
  const defaultResult = { cellValueType: CellValueType.String, isMultipleCellValue: false };

  try {
    return expression
      ? FormulaField.getParsedValueType(expression, keyBy(fields, 'id'))
      : defaultResult;
  } catch (e) {
    return defaultResult;
  }
};

export const FormulaOptionsInner = (props: {
  options: Partial<IFormulaFieldOptions> | undefined;
  onChange?: (options: Partial<IFormulaFieldOptions>) => void;
}) => {
  const { options = {}, onChange } = props;
  const { enable: enableAI } = useAI();
  const { expression, formatting, showAs } = options;
  const fields = useFields({ withHidden: true, withDenied: true });
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation(['table']);

  const expressionByName = useMemo(() => {
    return expression
      ? FormulaField.convertExpressionIdToName(expression, keyBy(fields, 'id'))
      : '';
  }, [expression, fields]);

  const { cellValueType, isMultipleCellValue } = calculateTypedValue(fields, expression);

  const onExpressionChange = (expr: string) => {
    const { cellValueType: newCellValueType } = calculateTypedValue(fields, expr);
    const newOptions: IFormulaFieldOptions = {
      expression: expr,
      timeZone:
        formatting && 'timeZone' in formatting && formatting?.timeZone
          ? formatting.timeZone
          : options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    if (newCellValueType !== cellValueType) {
      const defaultFormatting = getDefaultFormatting(newCellValueType);
      newOptions.formatting = defaultFormatting;
      newOptions.showAs = undefined;
    }
    onChange?.(newOptions);
    setVisible(false);
  };

  const setFormatting = useCallback(
    (newFormatting: IUnionFormatting) => {
      const formattingResult = getFormattingSchema(cellValueType).safeParse(newFormatting);
      const formattingParsed = formattingResult.success ? formattingResult.data : undefined;

      if (isEqual(formattingParsed, formatting)) {
        return;
      }
      onChange?.({
        formatting: isEmpty(formattingParsed) ? undefined : newFormatting,
        timeZone: options.timeZone,
      });
    },
    [cellValueType, formatting, onChange, options.timeZone]
  );

  const setTimeZone = useCallback(
    (newTimeZone: string) => {
      if (newTimeZone === options.timeZone) {
        return;
      }
      onChange?.({ timeZone: newTimeZone });
    },
    [options.timeZone, onChange]
  );

  const setShowAs = useCallback(
    (newShowAs?: IUnionShowAs) => {
      const showAsResult = getShowAsSchema(cellValueType, isMultipleCellValue).safeParse(newShowAs);
      const showAsParsed = showAsResult.success ? showAsResult.data : undefined;

      if (isEqual(showAsParsed, showAs)) {
        return;
      }
      onChange?.({ showAs: isEmpty(showAsParsed) ? undefined : newShowAs });
    },
    [cellValueType, isMultipleCellValue, onChange, showAs]
  );

  return (
    <div className="border-bordr w-full space-y-4 border-t pt-4">
      <div className="space-y-2">
        <span className="neutral-content text-sm font-medium">
          {t('field.default.formula.formula')}
          <RequireCom />
        </span>
        <Dialog open={visible} onOpenChange={setVisible}>
          <DialogTrigger asChild>
            <code className="block min-h-[36px] cursor-pointer items-center whitespace-pre-wrap break-words rounded-md border border-input bg-background px-3 py-2 ring-offset-background">
              {expressionByName}
            </code>
          </DialogTrigger>
          <DialogContent
            tabIndex={-1}
            closeable
            className="flex size-auto max-w-full overflow-hidden rounded-sm p-0 outline-0 md:w-auto"
          >
            <FormulaEditor
              expression={expression}
              onConfirm={onExpressionChange}
              enableAI={enableAI}
            />
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        <UnionFormatting
          cellValueType={cellValueType}
          formatting={formatting}
          onChange={setFormatting}
        />
        {cellValueType !== CellValueType.DateTime && (
          <TimeZoneFormatting
            timeZone={options?.timeZone}
            onChange={(value) => setTimeZone(value)}
          />
        )}
      </div>
      {Boolean(expression) && (
        <div className="space-y-2">
          <UnionShowAs
            showAs={showAs}
            cellValueType={cellValueType}
            isMultipleCellValue={isMultipleCellValue}
            onChange={setShowAs}
          />
        </div>
      )}
    </div>
  );
};

export const FormulaOptions = (props: {
  options: Partial<IFormulaFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  isMultipleCellValue?: boolean;
  onChange?: (options: Partial<IFormulaFieldOptions>) => void;
}) => {
  const {
    options,
    isLookup,
    cellValueType = CellValueType.String,
    isMultipleCellValue,
    onChange,
  } = props;
  const { expression, formatting, showAs } = options || {};

  if (isLookup) {
    return (
      <div className="w-full space-y-2">
        <div className="space-y-2">
          <UnionFormatting
            cellValueType={cellValueType}
            formatting={formatting}
            onChange={(formatting) => onChange?.({ formatting })}
          />
        </div>
        {Boolean(expression) && (
          <div className="space-y-2">
            <UnionShowAs
              showAs={showAs}
              cellValueType={cellValueType}
              isMultipleCellValue={isMultipleCellValue}
              onChange={(showAs) => onChange?.({ showAs })}
            />
          </div>
        )}
      </div>
    );
  }
  return <FormulaOptionsInner options={options} onChange={onChange} />;
};
