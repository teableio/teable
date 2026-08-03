import { KanbanViewCore } from '@teable/core';
import { updateViewOptions } from '@teable/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';

export class KanbanView extends Mixin(KanbanViewCore, View) {
  async updateOption({
    stackFieldId,
    coverFieldId,
    isCoverFit,
    isFieldNameHidden,
    isEmptyStackHidden,
  }: KanbanView['options']) {
    return await requestWrap(updateViewOptions)(this.tableId, this.id, {
      options: { stackFieldId, coverFieldId, isCoverFit, isFieldNameHidden, isEmptyStackHidden },
    });
  }
}
