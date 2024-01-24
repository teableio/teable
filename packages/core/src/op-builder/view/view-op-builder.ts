import type { IOtOperation } from '../../models/op';
import { OpName } from '../common';
import { AddViewBuilder } from './add-view';
import { SetViewPropertyBuilder } from './set-view-property';
import { UpdateViewColumnMetaBuilder } from './update-view-column-meta';

export class ViewOpBuilder {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static editor = {
    [OpName.SetViewProperty]: new SetViewPropertyBuilder(),
    [OpName.UpdateViewColumnMeta]: new UpdateViewColumnMetaBuilder(),
  };

  // eslint-disable-next-line @typescript-eslint/naming-convention
  static creator = new AddViewBuilder();

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
