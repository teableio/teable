/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IFilter,
  ISort,
  IShareViewMeta,
  IViewVo,
  IColumnMetaRo,
  IManualSortRo,
  IGroup,
} from '@teable/core';
import { ViewCore } from '@teable/core';
import type { IUpdateOrderRo } from '@teable/openapi';
import {
  disableShareView,
  enableShareView,
  updateViewColumnMeta,
  manualSortView,
  updateViewFilter,
  updateViewSort,
  updateViewGroup,
  updateViewOrder,
  updateViewName,
  updateViewDescription,
  updateViewShareMeta,
  refreshViewShareId,
  updateViewLocked,
} from '@teable/openapi';
import type { AxiosResponse } from 'axios';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';
import { enqueueViewUpdate } from './view-update-queue';

export abstract class View extends ViewCore {
  protected doc!: Doc<IViewVo>;

  tableId!: string;

  abstract updateOption(
    option: object // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<AxiosResponse<void, any>> | void;

  async apiEnableShare() {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(enableShareView)({ tableId: this.tableId, viewId: this.id })
    );
  }

  async disableShare() {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(disableShareView)({ tableId: this.tableId, viewId: this.id })
    );
  }

  async manualSort(sortRo: IManualSortRo) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(manualSortView)(this.tableId, this.id, sortRo)
    );
  }

  async updateColumnMeta(columnMetaRo: IColumnMetaRo) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewColumnMeta)(this.tableId, this.id, columnMetaRo)
    );
  }

  async updateFilter(filter: IFilter) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewFilter)(this.tableId, this.id, { filter })
    );
  }

  async updateSort(sort: ISort) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewSort)(this.tableId, this.id, { sort })
    );
  }

  async updateGroup(group: IGroup) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewGroup)(this.tableId, this.id, { group })
    );
  }

  async updateOrder(orderRo: IUpdateOrderRo) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewOrder)(this.tableId, this.id, orderRo)
    );
  }

  async updateName(name: string) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewName)(this.tableId, this.id, { name })
    );
  }

  async updateDescription(description: string) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewDescription)(this.tableId, this.id, { description })
    );
  }

  async setRefreshLink() {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(refreshViewShareId)(this.tableId, this.id)
    );
  }

  async setShareMeta(shareMeta: IShareViewMeta) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewShareMeta)(this.tableId, this.id, shareMeta)
    );
  }

  async updateLocked(isLocked: boolean) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewLocked)(this.tableId, this.id, { isLocked })
    );
  }
}
