import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetViewDescriptionOpContext {
  name: OpName.SetViewDescription;
  newDescription: string;
  oldDescription?: string;
}

export class SetViewDescriptionBuilder implements IOpBuilder {
  name: OpName.SetViewDescription = OpName.SetViewDescription;

  build(params: { newDescription?: string; oldDescription?: string }): IOtOperation {
    const { newDescription, oldDescription } = params;

    return {
      p: ['description'],
      oi: newDescription,
      ...(oldDescription ? { od: oldDescription } : {}),
    };
  }

  detect(op: IOtOperation): ISetViewDescriptionOpContext | null {
    const { p, oi, od } = op;

    const result = pathMatcher<Record<string, never>>(p, ['description']);

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
