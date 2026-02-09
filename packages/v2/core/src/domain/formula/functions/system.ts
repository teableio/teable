import { err, ok } from 'neverthrow';

import { domainError } from '../../shared/DomainError';
import { CellValueType } from '../CellValueType';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class SystemFunc extends FormulaFunc {
  readonly type = FormulaFuncType.System;
}

export class TextAll extends SystemFunc {
  name = FunctionName.TextAll;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.TextAll} only allow 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() =>
      params[0].isMultiple
        ? { type: CellValueType.String, isMultiple: true }
        : { type: CellValueType.String }
    );
  }
}

export class RecordId extends SystemFunc {
  name = FunctionName.RecordId;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(_: TypedValue[]): ReturnType<FormulaFunc['validateParams']> {
    return ok(undefined);
  }

  getReturnType() {
    return ok({ type: CellValueType.String });
  }
}

export class AutoNumber extends SystemFunc {
  name = FunctionName.RecordId;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(_: TypedValue[]): ReturnType<FormulaFunc['validateParams']> {
    return ok(undefined);
  }

  getReturnType() {
    return ok({ type: CellValueType.Number });
  }
}
