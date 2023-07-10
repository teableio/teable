import type { IFieldSnapshot, IFilter } from '@teable-group/core';
import { OpBuilder, ViewCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';

export abstract class ViewOperations extends ViewCore {
  protected doc!: Doc<IFieldSnapshot>;

  private async submitOperation(operation: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.doc.submitOp([operation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }

  async updateName(name: string): Promise<void> {
    const viewOperation = OpBuilder.editor.setViewName.build({
      newName: name,
      oldName: this.name,
    });

    return await this.submitOperation(viewOperation);
  }

  async setFilter(filter?: IFilter): Promise<void> {
    const viewOperation = OpBuilder.editor.setViewFilter.build({
      newFilter: filter,
      oldFilter: this.filter,
    });

    return await this.submitOperation(viewOperation);
  }
}
