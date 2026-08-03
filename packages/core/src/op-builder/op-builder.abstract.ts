import type { IOtOperation } from '../models';
import type { IOpBuilder } from './interface';

export abstract class OpBuilderAbstract {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static editor: { [key: string]: IOpBuilder };

  static ops2Contexts(ops: IOtOperation[]) {
    return ops.map((op) => {
      const result = this.detect(op);
      if (!result) {
        throw new Error(`can't detect op: ${JSON.stringify(op)}`);
      }
      return result;
    });
  }

  static detect(op: IOtOperation) {
    for (const builder of Object.values(this.editor)) {
      const result = builder.detect(op);
      if (result) {
        return result;
      }
    }
    return null;
  }
}
