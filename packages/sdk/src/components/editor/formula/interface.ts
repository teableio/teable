import type { FormulaFuncType, FunctionName } from '@teable/core';
import type { IFunctionSchema } from '@teable/openapi';

export interface IFocusToken {
  value: string;
  index: number;
}

export interface IFuncHelpData {
  funcName: FunctionName;
  focusParamIndex: number;
}

export type IFunctionMap = {
  [key in FormulaFuncType]: IFunctionCollectionItem;
};

export interface IFunctionCollectionItem {
  name: string;
  type: FormulaFuncType;
  list: IFunctionSchema<FunctionName>[];
  prevCount: number;
  sortIndex: number;
}

export enum SuggestionItemType {
  Field = 'field',
  Function = 'function',
}
