/* eslint-disable @typescript-eslint/naming-convention */
import type { IFilter, ISort, IViewVo } from '@teable-group/core';
import { sortSchema, filterSchema, ViewCore, ViewOpBuilder } from '@teable-group/core';
import {
  createView,
  deleteView,
  getViewAggregations,
  getViewList,
  getViewRowCount,
  manualSortView,
} from '@teable-group/openapi';
import type { Doc } from 'sharedb/lib/client';

export abstract class View extends ViewCore {
  protected doc!: Doc<IViewVo>;

  static getViews = getViewList;

  static createView = createView;

  static deleteView = deleteView;

  static getViewAggregations = getViewAggregations;

  static getViewRowCount = getViewRowCount;

  static manualSort = manualSortView;

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

  async setSort(newSort?: ISort | null): Promise<void> {
    const validSort = newSort && (await sortSchema.parseAsync(newSort));

    const viewOperation = ViewOpBuilder.editor.setViewSort.build({
      newSort: validSort,
      oldSort: this.sort,
    });
    return await this.submitOperation(viewOperation);
  }
}
