import type { IViewVo } from '@teable-group/core';
import { KanbanViewCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import type { View } from './view';
import { ViewExtended } from './view';

export class KanbanView extends KanbanViewCore implements View {
  protected doc!: Doc<IViewVo>;

  async updateName(name: string) {
    return ViewExtended.updateName(this.doc, name, this.name);
  }
}
