import { GridViewCore } from '@teable-group/core';
import { setViewOption } from '@teable-group/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';

export class GridView extends Mixin(GridViewCore, View) {
  async setOption({ rowHeight }: GridView['options']) {
    return await requestWrap(setViewOption)(this.tableId, this.id, { rowHeight });
  }

  async updateFrozenColumnCount(frozenColumnCount: number) {
    return await requestWrap(setViewOption)(this.tableId, this.id, { frozenColumnCount });
  }
}
