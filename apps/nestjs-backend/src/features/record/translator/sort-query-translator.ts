import type { ISort } from '@teable-group/core';
import type { IFieldInstance } from '../../field/model/factory';

export class SortQueryTranslator {
  public static translateToOrderQuery(
    orderBy: ISort['sortObjs'],
    orderFieldName: string,
    fields?: { [fieldId: string]: IFieldInstance }
  ) {
    const defaultOrderby = [{ column: orderFieldName, order: 'asc' }];

    if (!fields) {
      return defaultOrderby;
    }

    return orderBy.map((order) => {
      const field = fields[order?.fieldId];
      return {
        column: field?.dbFieldName || order.fieldId,
        order: order.order,
      };
    });
  }
}
