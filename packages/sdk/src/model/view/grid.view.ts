import type { IViewVo, RowHeightLevel } from '@teable-group/core';
import { GridViewCore, ViewOpBuilder } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import type { View } from './view';
import { ViewExtended } from './view';

export class GridView extends GridViewCore implements View {
  protected doc!: Doc<IViewVo>;

  async updateName(name: string) {
    return ViewExtended.updateName(this.doc, name, this.name);
  }

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
