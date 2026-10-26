import { GridViewCore } from '@teable/core';
import { updateViewOptions } from '@teable/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';
import { enqueueViewUpdate } from './view-update-queue';

export class GridView extends Mixin(GridViewCore, View) {
  async updateOption(options: Partial<GridView['options']>) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewOptions)(this.tableId, this.id, {
        options,
      })
    );
  }
}
