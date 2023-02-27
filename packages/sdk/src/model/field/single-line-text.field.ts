import { IFieldSnapshot, SingleLineTextFieldCore } from '@teable-group/core';
import { Field, FieldExtended } from './field';
import { Doc } from 'sharedb/lib/sharedb';

export class SingleLineTextField extends SingleLineTextFieldCore implements Field {
  protected doc!: Doc<IFieldSnapshot>;

  async updateName(name: string) {
    return FieldExtended.updateName(this.doc, name, this.name);
  }
}
