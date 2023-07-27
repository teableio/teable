import type { RowHeightLevel } from '@teable-group/core';
import { GridViewCore, ViewOpBuilder } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { View } from './view';

export class GridView extends Mixin(GridViewCore, View) {
  async updateRowHeight(rowHeight: RowHeightLevel) {
    const viewOperation = ViewOpBuilder.editor.setViewOption.build({
      newOptions: {
        ...(this.options || {}),
        rowHeight,
      },
      oldOptions: this.options,
    });

    return new Promise<void>((resolve, reject) => {
      this.doc.submitOp([viewOperation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}
