import { IViewSnapshot, KanbanViewCore } from '@teable-group/core';
import { View, ViewExtended } from './view';
import { Doc } from 'sharedb/lib/client';

export class KanbanView extends KanbanViewCore implements View {
  protected doc!: Doc<IViewSnapshot>;

  async updateName(name: string) {
    return ViewExtended.updateName(this.doc, name, this.name);
  }
}
