import type { FormulaFuncType, FunctionName, FUNCTIONS } from '@teable/core';

export interface IFocusToken {
  value: string;
  index: number;
}

export interface IFuncHelpData {
  funcName: FunctionName;
  focusParamIndex: number;
}

export interface IFunctionSchema<T extends FunctionName> {
  name: T;
  func: (typeof FUNCTIONS)[T];
  params: string[];
  definition: string;
  summary: string;
  example: string;
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
