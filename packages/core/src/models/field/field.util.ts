import { FieldType } from './constant';
import type { FormulaFieldCore } from './derivate';
import type { FieldCore } from './field';

export function isFormulaField(field: FieldCore): field is FormulaFieldCore {
  return field.type === FieldType.Formula;
}

export function isGeneratedFormulaField(field: FieldCore): field is FormulaFieldCore {
  return isFormulaField(field) && field.options.dbGenerated;
}
