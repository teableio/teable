import type { IOtOperation } from '../../models/op';
import { OpName } from '../common';
import { AddViewBuilder } from './add-view';
import { SetViewColumnMetaBuilder } from './set-view-column-meta';
import { SetViewDescriptionBuilder } from './set-view-description';
import { SetViewEnableShareBuilder } from './set-view-enable-share';
import { SetViewFilterBuilder } from './set-view-filter';
import { SetViewGroupBuilder } from './set-view-group';
import { SetViewNameBuilder } from './set-view-name';
import { SetViewOptionBuilder } from './set-view-option';
import { SetViewOrderBuilder } from './set-view-order';
import { SetViewShareIdBuilder } from './set-view-share-id';
import { SetViewShareMetaBuilder } from './set-view-share-meta';
import { SetViewSortBuilder } from './set-view-sort';

export class ViewOpBuilder {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static editor = {
    [OpName.SetViewName]: new SetViewNameBuilder(),
    [OpName.SetViewDescription]: new SetViewDescriptionBuilder(),
    [OpName.SetViewFilter]: new SetViewFilterBuilder(),
    [OpName.SetViewSort]: new SetViewSortBuilder(),
    [OpName.SetViewGroup]: new SetViewGroupBuilder(),
    [OpName.SetViewOptions]: new SetViewOptionBuilder(),
    [OpName.SetViewOrder]: new SetViewOrderBuilder(),
    [OpName.SetViewColumnMeta]: new SetViewColumnMetaBuilder(),
    [OpName.SetViewEnableShare]: new SetViewEnableShareBuilder(),
    [OpName.SetViewShareId]: new SetViewShareIdBuilder(),
    [OpName.SetViewShareMeta]: new SetViewShareMetaBuilder(),
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
