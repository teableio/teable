/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention */
import type { FunctionName } from '@teable/core';
import { FormulaFuncType, FormulaLexer } from '@teable/core';
import { Hash, A, CheckSquare, Calendar } from '@teable/icons';
import type { IFunctionSchema } from '@teable/openapi';
import { funcDefine } from '@teable/openapi';
import { useMemo } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import type { IFunctionMap } from './interface';

export const Type2IconMap = {
  [FormulaFuncType.Text]: A,
  [FormulaFuncType.Numeric]: Hash,
  [FormulaFuncType.DateTime]: Calendar,
  [FormulaFuncType.Logical]: CheckSquare,
  [FormulaFuncType.Array]: A,
  [FormulaFuncType.System]: A,
};

export const FOCUS_TOKENS_SET = new Set([
  FormulaLexer.IDENTIFIER,
  FormulaLexer.IDENTIFIER_UNICODE,
  FormulaLexer.IDENTIFIER_VARIABLE,
  FormulaLexer.SINGLEQ_STRING_LITERAL,
  FormulaLexer.DOUBLEQ_STRING_LITERAL,
  FormulaLexer.NUMERIC_LITERAL,
  FormulaLexer.INTEGER_LITERAL,
]);

export const useFunctionsDisplayMap = (): IFunctionMap => {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      [FormulaFuncType.Numeric]: {
        name: t('functionType.numeric'),
        type: FormulaFuncType.Numeric,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
      [FormulaFuncType.Text]: {
        name: t('functionType.text'),
        type: FormulaFuncType.Text,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
      [FormulaFuncType.Logical]: {
        name: t('functionType.logical'),
        type: FormulaFuncType.Logical,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
      [FormulaFuncType.DateTime]: {
        name: t('functionType.date'),
        type: FormulaFuncType.DateTime,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
      [FormulaFuncType.Array]: {
        name: t('functionType.array'),
        type: FormulaFuncType.Array,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
      [FormulaFuncType.System]: {
        name: t('functionType.system'),
        type: FormulaFuncType.System,
        list: [],
        prevCount: 0,
        sortIndex: -1,
      },
    }),
    [t]
  );
};

export const useFormulaFunctionsMap = () => {
  const { t } = useTranslation();

  return useMemo(
    () =>
      new Map<FunctionName, IFunctionSchema<FunctionName>>(
        funcDefine.map(
          ([name, schema]) =>
            [
              name,
              {
                ...schema,
                summary: t(`formula.${name}.summary`),
                example: t(`formula.${name}.example`),
              },
            ] as [FunctionName, IFunctionSchema<FunctionName>]
        )
      ),
    [t]
  );
};
