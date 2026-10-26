import { KanbanViewCore } from '@teable/core';
import { updateViewOptions } from '@teable/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';
import { enqueueViewUpdate } from './view-update-queue';

export class KanbanView extends Mixin(KanbanViewCore, View) {
  async updateOption({
    stackFieldId,
    coverFieldId,
    isCoverFit,
    isFieldNameHidden,
    isEmptyStackHidden,
  }: KanbanView['options']) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewOptions)(this.tableId, this.id, {
        options: { stackFieldId, coverFieldId, isCoverFit, isFieldNameHidden, isEmptyStackHidden },
      })
    );
  }
}
