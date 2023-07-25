import type { IViewVo, IFilter } from '@teable-group/core';
import { filterSchema, ViewOpBuilder, ViewCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';

export abstract class ViewOperations extends ViewCore {
  protected doc!: Doc<IViewVo>;

  private async submitOperation(operation: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.doc.submitOp([operation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }

  async updateName(name: string): Promise<void> {
    const viewOperation = ViewOpBuilder.editor.setViewName.build({
      newName: name,
      oldName: this.name,
    });

    return await this.submitOperation(viewOperation);
  }

  async setFilter(newFilter?: IFilter | null): Promise<void> {
    const validFilter = newFilter && (await filterSchema.parseAsync(newFilter));

    const viewOperation = ViewOpBuilder.editor.setViewFilter.build({
      newFilter: validFilter,
      oldFilter: this.filter,
    });
    return await this.submitOperation(viewOperation);
  }
}
