import { FormViewCore } from '@teable/core';
import { updateViewOptions } from '@teable/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';
import { enqueueViewUpdate } from './view-update-queue';

export class FormView extends Mixin(FormViewCore, View) {
  async updateOption({ coverUrl, logoUrl, submitLabel }: FormView['options']) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewOptions)(this.tableId, this.id, {
        options: { coverUrl, logoUrl, submitLabel },
      })
    );
  }
}
