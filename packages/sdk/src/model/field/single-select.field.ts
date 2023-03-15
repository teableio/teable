import type { IFieldSnapshot } from '@teable-group/core';
import { SingleSelectFieldCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import type { Field } from './field';
import { FieldExtended } from './field';

export class SingleSelectField extends SingleSelectFieldCore implements Field {
  protected doc!: Doc<IFieldSnapshot>;

  async updateName(name: string) {
    return FieldExtended.updateName(this.doc, name, this.name);
  }
}
