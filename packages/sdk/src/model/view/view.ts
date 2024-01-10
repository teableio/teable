/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IFilter,
  IOtOperation,
  IShareViewMeta,
  ISort,
  IViewVo,
  IColumnMetaRo,
  IManualSortRo,
  IGroup,
} from '@teable-group/core';
import {
  sortSchema,
  filterSchema,
  ViewCore,
  ViewOpBuilder,
  generateShareId,
  groupSchema,
} from '@teable-group/core';
import {
  createView,
  deleteView,
  disableShareView,
  enableShareView,
  getViewList,
  setViewColumnMeta,
  manualSortView,
} from '@teable-group/openapi';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';

export abstract class View extends ViewCore {
  protected doc!: Doc<IViewVo>;

  tableId!: string;

  static getViews = requestWrap(getViewList);

  static createView = requestWrap(createView);

  static deleteView = requestWrap(deleteView);

  async apiEnableShare() {
    return await requestWrap(enableShareView)({ tableId: this.tableId, viewId: this.id });
  }

  async disableShare() {
    return await requestWrap(disableShareView)({ tableId: this.tableId, viewId: this.id });
  }

  async manualSort(sortRo: IManualSortRo) {
    return await requestWrap(manualSortView)(this.tableId, this.id, sortRo);
  }

  async setViewColumnMeta(columnMetaRo: IColumnMetaRo) {
    return await requestWrap(setViewColumnMeta)(this.tableId, this.id, columnMetaRo);
  }

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

  async setGroup(newGroup?: IGroup | null) {
    const validGroup = newGroup && (await groupSchema.parseAsync(newGroup));

    const viewOperation = ViewOpBuilder.editor.setViewGroup.build({
      newGroup: validGroup,
      oldGroup: this.group,
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
