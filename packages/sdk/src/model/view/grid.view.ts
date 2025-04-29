import { GridViewCore } from '@teable/core';
import { updateViewOptions } from '@teable/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';

export class GridView extends Mixin(GridViewCore, View) {
  async updateOption({ rowHeight, frozenColumnCount, fieldNameDisplayLines }: GridView['options']) {
    return await requestWrap(updateViewOptions)(this.tableId, this.id, {
      options: { rowHeight, frozenColumnCount, fieldNameDisplayLines },
    });
  }
}
