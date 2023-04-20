import { FieldType } from '@teable-group/core';
import type { IGridCell } from './type';

export const girdCellToCellValue = (cell: IGridCell) => {
  // TODO: After the field more delete the following comments
  // eslint-disable-next-line sonarjs/no-small-switch
  switch (cell.type) {
    case FieldType.SingleSelect: {
      return cell.value[0] || '';
    }
    default:
  }
};
