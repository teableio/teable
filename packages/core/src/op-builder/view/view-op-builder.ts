import type { IOtOperation } from '../../models/op';
import { AddViewBuilder } from './add-view';
import { SetViewDescriptionBuilder } from './set-view-description';
import { SetViewEnableShareBuilder } from './set-view-enable-share';
import { SetViewFilterBuilder } from './set-view-filter';
import { SetViewNameBuilder } from './set-view-name';
import { SetViewOptionBuilder } from './set-view-option';
import { SetViewShareIdBuilder } from './set-view-share-id';
import { SetViewShareMetaBuilder } from './set-view-share-meta';
import { SetViewSortBuilder } from './set-view-sort';

export abstract class ViewOpBuilder {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static editor = {
    setViewName: new SetViewNameBuilder(),
    setViewDescription: new SetViewDescriptionBuilder(),
    setViewFilter: new SetViewFilterBuilder(),
    setViewSort: new SetViewSortBuilder(),
    setViewOption: new SetViewOptionBuilder(),
    setViewEnableShare: new SetViewEnableShareBuilder(),
    setViewShareId: new SetViewShareIdBuilder(),
    setViewShareMeta: new SetViewShareMetaBuilder(),
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
