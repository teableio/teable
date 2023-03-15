import type { IFieldSnapshot } from '@teable-group/core';
import { SingleLineTextFieldCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/sharedb';
import type { Field } from './field';
import { FieldExtended } from './field';

export class SingleLineTextField extends SingleLineTextFieldCore implements Field {
  protected doc!: Doc<IFieldSnapshot>;

  async updateName(name: string) {
    return FieldExtended.updateName(this.doc, name, this.name);
  }
}
