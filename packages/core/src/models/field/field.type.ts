import type {
  AutoNumberFieldCore,
  CreatedTimeFieldCore,
  FormulaFieldCore,
  LastModifiedTimeFieldCore,
} from './derivate';

export type IFieldWithExpression =
  | FormulaFieldCore
  | AutoNumberFieldCore
  | CreatedTimeFieldCore
  | LastModifiedTimeFieldCore;
