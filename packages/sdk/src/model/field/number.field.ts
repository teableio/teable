import type { IFieldSnapshot } from '@teable-group/core';
import { NumberFieldCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import type { Field } from './field';
import { FieldExtended } from './field';

export class NumberField extends NumberFieldCore implements Field {
  protected doc!: Doc<IFieldSnapshot>;

  async updateName(name: string) {
    return FieldExtended.updateName(this.doc, name, this.name);
  }
}
