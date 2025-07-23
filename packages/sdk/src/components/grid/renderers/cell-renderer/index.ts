import { booleanCellRenderer } from './booleanCellRenderer';
import { buttonCellRenderer } from './buttonCellRenderer';
import { chartCellRenderer } from './chartCellRenderer';
import { imageCellRenderer } from './imageCellRenderer';
import { CellType } from './interface';
import { linkCellRenderer } from './linkCellRenderer';
import { loadingCellRenderer } from './loadingCellRenderer';
import { numberCellRenderer } from './numberCellRenderer';
import { ratingCellRenderer } from './ratingCellRenderer';
import { selectCellRenderer } from './selectCellRenderer';
import { textCellRenderer } from './textCellRenderer';
import { userCellRenderer } from './userCellRenderer';

export * from './interface';
export * from './utils';

export const getCellRenderer = (cellType: CellType) => {
  switch (cellType) {
    case CellType.Text:
      return textCellRenderer;
    case CellType.Link:
      return linkCellRenderer;
    case CellType.Number:
      return numberCellRenderer;
    case CellType.Boolean:
      return booleanCellRenderer;
    case CellType.Select:
      return selectCellRenderer;
    case CellType.Image:
      return imageCellRenderer;
    case CellType.Rating:
      return ratingCellRenderer;
    case CellType.Chart:
      return chartCellRenderer;
    case CellType.User:
      return userCellRenderer;
    case CellType.Button:
      return buttonCellRenderer;
    case CellType.Loading:
    default:
      return loadingCellRenderer;
  }
};
