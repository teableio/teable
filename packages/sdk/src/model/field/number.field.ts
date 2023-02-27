import { IFieldSnapshot, NumberFieldCore } from '@teable-group/core';
import { Field, FieldExtended } from './field';
import { Doc } from 'sharedb/lib/client';

export class NumberField extends NumberFieldCore implements Field {
  protected doc!: Doc<IFieldSnapshot>;

  async updateName(name: string) {
    return FieldExtended.updateName(this.doc, name, this.name);
  }
}
