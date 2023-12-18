/* eslint-disable @typescript-eslint/naming-convention */
import type { IFilter, IOtOperation, IShareViewMeta, ISort, IViewVo } from '@teable-group/core';
import {
  sortSchema,
  filterSchema,
  ViewCore,
  ViewOpBuilder,
  generateShareId,
} from '@teable-group/core';
import {
  createView,
  deleteView,
  disableShareView,
  enableShareView,
  getViewAggregations,
  getViewList,
  getViewRowCount,
  setViewColumnMeta,
  manualSortView,
} from '@teable-group/openapi';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';

export abstract class View extends ViewCore {
  protected doc!: Doc<IViewVo>;

  static getViews = requestWrap(getViewList);

  static createView = requestWrap(createView);

  static deleteView = requestWrap(deleteView);

  static getViewAggregations = requestWrap(getViewAggregations);

  static getViewRowCount = requestWrap(getViewRowCount);

  static manualSort = requestWrap(manualSortView);

  static enableShare = requestWrap(enableShareView);

  static disableShare = requestWrap(disableShareView);

  static setViewColumnMeta = requestWrap(setViewColumnMeta);

  async submitOperation(operation: IOtOperation) {
    try {
      return await new Promise((resolve, reject) => {
        this.doc.submitOp([operation], undefined, (error) => {
          error ? reject(error) : resolve(undefined);
        });
      });
    } catch (error) {
      return error;
    }
  }

  async updateName(name: string) {
    const viewOperation = ViewOpBuilder.editor.setViewName.build({
      newName: name,
      oldName: this.name,
    });

    return await this.submitOperation(viewOperation);
  }

  async updateDescription(description: string) {
    const viewOperation = ViewOpBuilder.editor.setViewDescription.build({
      newDescription: description,
      oldDescription: this.description,
    });

    return await this.submitOperation(viewOperation);
  }

  async setFilter(newFilter?: IFilter | null) {
    const validFilter = newFilter && (await filterSchema.parseAsync(newFilter));

    const viewOperation = ViewOpBuilder.editor.setViewFilter.build({
      newFilter: validFilter,
      oldFilter: this.filter,
    });

    return await this.submitOperation(viewOperation);
  }

  async setSort(newSort?: ISort | null) {
    const validSort = newSort && (await sortSchema.parseAsync(newSort));

    const viewOperation = ViewOpBuilder.editor.setViewSort.build({
      newSort: validSort,
      oldSort: this.sort,
    });
    return await this.submitOperation(viewOperation);
  }

  async setRefreshLink() {
    const viewOperation = ViewOpBuilder.editor.setViewShareId.build({
      newShareId: generateShareId(),
      oldShareId: this.shareId,
    });
    return await this.submitOperation(viewOperation);
  }

  async setShareMeta(newShareMeta?: IShareViewMeta) {
    const viewOperation = ViewOpBuilder.editor.setViewShareMeta.build({
      newShareMeta,
      oldShareMeta: this.shareMeta,
    });
    return await this.submitOperation(viewOperation);
  }
}
