/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IFilter,
  ISort,
  IOtOperation,
  IShareViewMeta,
  IViewVo,
  IColumnMetaRo,
  IManualSortRo,
  IGroup,
} from '@teable-group/core';
import { ViewCore, ViewOpBuilder, generateShareId } from '@teable-group/core';
import {
  createView,
  deleteView,
  disableShareView,
  enableShareView,
  getViewList,
  setViewColumnMeta,
  manualSortView,
  setViewFilter,
  setViewSort,
  setViewGroup,
} from '@teable-group/openapi';
import type { AxiosResponse } from 'axios';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';

export abstract class View extends ViewCore {
  protected doc!: Doc<IViewVo>;

  tableId!: string;

  static getViews = requestWrap(getViewList);

  static createView = requestWrap(createView);

  static deleteView = requestWrap(deleteView);

  abstract setOption(
    option: object // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<AxiosResponse<void, any>> | void;

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

  async setViewFilter(filter: IFilter) {
    return await requestWrap(setViewFilter)(this.tableId, this.id, { filter });
  }

  async setViewSort(sort: ISort) {
    return await requestWrap(setViewSort)(this.tableId, this.id, { sort });
  }

  async setViewGroup(group: IGroup) {
    return await requestWrap(setViewGroup)(this.tableId, this.id, group);
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
