import type { CustomRenderer } from '@glideapps/glide-data-grid';
import { GridCellKind } from '@glideapps/glide-data-grid';
import { FieldType } from '@teable-group/core';
import { isMatchCustomCell } from '../../utils';
import { attachmentCell } from './attachmentCell';
import { loadingCell } from './loadingCell';
import { selectCell } from './selectCell';
import type { ICustomCellGridCell, IGridCell } from './type';

export const BaseCell: CustomRenderer<ICustomCellGridCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is ICustomCellGridCell => isMatchCustomCell((c.data as IGridCell).type),
  draw: (args, cell) => {
    const { type } = cell.data;

    // eslint-disable-next-line sonarjs/no-small-switch
    switch (type) {
      case FieldType.SingleSelect:
      case FieldType.MultipleSelect:
      case FieldType.Link:
        selectCell(args, cell);
        break;
      case FieldType.Attachment:
        attachmentCell(args, cell);
        break;
      default:
        loadingCell(args, cell);
    }

    return true;
  },
  provideEditor: () => ({
    editor: () => <></>,
    styleOverride: {
      display: 'none',
    },
  }),
};
