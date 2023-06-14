import type { IFieldSnapshot } from '@teable-group/core';
import { LinkFieldCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import type { Field } from './field';
import { FieldExtended } from './field';

export class LinkField extends LinkFieldCore implements Field {
  doc!: Doc<IFieldSnapshot>;

  async updateName(name: string) {
    return FieldExtended.updateName(this.doc, name, this.name);
  }

  async updateColumnWidth(viewId: string, width: number): Promise<void> {
    const oldWidth = this.columnMeta[viewId].width;
    return FieldExtended.updateColumnWidth(this.doc, viewId, width, oldWidth);
  }

  async updateColumnHidden(viewId: string, hidden: boolean): Promise<void> {
    const oldHidden = this.columnMeta[viewId]?.hidden;
    return FieldExtended.updateColumnHidden(this.doc, viewId, hidden, oldHidden);
  }

  async delete(): Promise<void> {
    return FieldExtended.delete(this.doc);
  }
}
