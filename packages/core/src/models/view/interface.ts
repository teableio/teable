export interface IViewBase {
  id: string;
  name: string;
  type: string;
  query?: {
    filter: string[];
    sort: string[];
  };
}

export interface IGridView extends IViewBase {
  type: 'grid';
  columns: {
    fieldId: string;
    width: number;
    hidden: boolean;
  }[];
}

export interface IGalleryView extends IViewBase {
  type: 'gallery';
  columns: {
    fieldId: string;
    hidden: boolean;
  }[];
}

export type IView = IGridView | IGalleryView;
