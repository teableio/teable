import type {
  IFilter,
  ISort,
  IViewVo,
  IJsonApiSuccessResponse,
  IViewAggregationVo,
  IViewRowCountVo,
  StatisticsFunc,
  IAggregationsValue,
} from '@teable-group/core';
import {
  FieldKeyType,
  sortSchema,
  filterSchema,
  ViewCore,
  ViewOpBuilder,
} from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import { axios } from '../../config/axios';

export abstract class View extends ViewCore {
  protected doc!: Doc<IViewVo>;

  static async getViews(tableId: string) {
    const response = await axios.get<IJsonApiSuccessResponse<IViewVo[]>>(
      `/api/table/${tableId}/view`
    );
    return response.data.data;
  }

  static async getViewAggregation(tableId: string, viewId: string) {
    const response = await axios.get<IJsonApiSuccessResponse<IViewAggregationVo>>(
      `/api/table/${tableId}/aggregation/${viewId}`
    );
    return response.data.data;
  }

  static async getViewRowCount(tableId: string, viewId: string) {
    const response = await axios.get<IJsonApiSuccessResponse<IViewRowCountVo>>(
      `/api/table/${tableId}/aggregation/${viewId}/rowCount`
    );
    return response.data.data;
  }

  static async getAggregationByFunc(
    tableId: string,
    viewId: string,
    fieldId: string,
    func: StatisticsFunc
  ) {
    const response = await axios.get<IJsonApiSuccessResponse<IAggregationsValue>>(
      `/api/table/${tableId}/aggregation/${viewId}/${fieldId}/${func}`,
      { params: { fieldKeyType: FieldKeyType.Id } }
    );
    return response.data.data;
  }

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
