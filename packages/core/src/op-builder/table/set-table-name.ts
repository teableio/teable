import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetTableNameOpContext {
  name: OpName.SetTableName;
  newName: string;
  oldName: string;
}

export class SetTableNameBuilder implements IOpBuilder {
  name: OpName.SetTableName = OpName.SetTableName;

  build(params: { newName: string; oldName: string }): IOtOperation {
    const { newName, oldName } = params;

    return {
      p: ['table', 'name'],
      oi: newName,
      od: oldName,
    };
  }

  detect(op: IOtOperation): ISetTableNameOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['table', 'name']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newName: oi,
      oldName: od,
    };
  }
}
