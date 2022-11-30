export type FileNode = {
  name: string;
  path: string;
  isDirectory?: boolean;
  type: string;
  children?: FileNode[];
};

// table schema start here
export interface IFieldBase {
  id: string;
  name: string;
  type: string;
  isPrimaryKey?: boolean;
}

export interface ITextField extends IFieldBase {
  type: 'text';
  defaultValue: string;
}

export interface INumberField extends IFieldBase {
  type: 'number';
  defaultValue: number;
}

export interface ISelectField extends IFieldBase {
  type: 'select';
  options: string[];
  defaultValue: string;
}

export interface IMultiSelectField extends IFieldBase {
  type: 'multi-select';
  options: string[];
  defaultValue: string[];
}

export interface ICheckboxField extends IFieldBase {
  type: 'checkbox';
  defaultValue: boolean;
}

export interface IDateField extends IFieldBase {
  type: 'date';
  defaultValue: number;
}

export interface ICreatedByField extends IFieldBase {
  type: 'created-by';
  defaultValue: string;
}

export interface ILastUpdatedByField extends IFieldBase {
  type: 'last-updated-by';
  defaultValue: string;
}

export interface ICreatedTimeField extends IFieldBase {
  type: 'created-time';
  defaultValue: number;
}

export interface ILastUpdatedTimeField extends IFieldBase {
  type: 'last-updated-time';
  defaultValue: number;
}

export type IField =
  | ITextField
  | INumberField
  | ISelectField
  | IMultiSelectField
  | ICheckboxField
  | IDateField
  | ICreatedByField
  | ILastUpdatedByField
  | ICreatedTimeField
  | ILastUpdatedTimeField;

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

export interface ITable {
  id: string;
  name: string;
  description: string;
  fieldMap: {
    [fieldId: string]: IField;
  };
  viewList: string;
  viewMap: {
    [viewId: string]: IView;
  };
}
export interface ITeable {
  id: string;
  name: string;
  description: string;
  schemaVersion: string;
  tableList: string[];
  schema: {
    [tableId: string]: ITable;
  };
}
