import { CellType } from './interface';
import { numberCellRenderer } from './numberCellRenderer';
import { selectCellRenderer } from './selectCellRenderer';
import { textCellRenderer } from './textCellRenderer';

export * from './interface';

export const getCellRenderer = (cellType: CellType) => {
  switch (cellType) {
    case CellType.Select:
      return selectCellRenderer;
    case CellType.Number:
      return numberCellRenderer;
    case CellType.Text:
    default:
      return textCellRenderer;
  }
};
