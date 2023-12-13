import type { RowHeightLevel } from '@teable-group/core';
import { GridViewCore } from '@teable-group/core';
import { setViewOption } from '@teable-group/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';

export class GridView extends Mixin(GridViewCore, View) {
  async updateRowHeight(tableId: string, rowHeight: RowHeightLevel) {
    return await requestWrap(setViewOption)(tableId, this.id, { rowHeight });
  }
}
