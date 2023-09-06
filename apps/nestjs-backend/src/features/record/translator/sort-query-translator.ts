import type { ISort } from '@teable-group/core';
import { isEmpty } from 'lodash';
import type { IFieldInstance } from '../../field/model/factory';

export class SortQueryTranslator {
  public static translateToOrderQuery(
    sortObjs: ISort['sortObjs'],
    fieldsMap?: { [fieldId: string]: IFieldInstance }
  ) {
    if (!fieldsMap || isEmpty(fieldsMap)) {
      return [];
    }

    return sortObjs.map((sortItem) => {
      const field = fieldsMap[sortItem?.fieldId];
      return {
        column: field?.dbFieldName || sortItem.fieldId,
        order: sortItem.order,
      };
    });
  }
}
