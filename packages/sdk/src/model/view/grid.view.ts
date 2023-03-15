import type { IViewSnapshot } from '@teable-group/core';
import { GridViewCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import type { View } from './view';
import { ViewExtended } from './view';

export class GridView extends GridViewCore implements View {
  protected doc!: Doc<IViewSnapshot>;

  async updateName(name: string) {
    return ViewExtended.updateName(this.doc, name, this.name);
  }
}
