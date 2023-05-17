import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetFieldDescriptionOpContext {
  name: OpName.SetFieldDescription;
  newDescription: string;
  oldDescription: string;
}

export class SetFieldDescriptionBuilder implements IOpBuilder {
  name: OpName.SetFieldDescription = OpName.SetFieldDescription;

  build(params: { newDescription: string | null; oldDescription: string | null }): IOtOperation {
    const { newDescription, oldDescription } = params;

    return {
      p: ['field', 'description'],
      oi: newDescription,
      od: oldDescription,
    };
  }

  detect(op: IOtOperation): ISetFieldDescriptionOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['field', 'description']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      newDescription: oi,
      oldDescription: od,
    };
  }
}
