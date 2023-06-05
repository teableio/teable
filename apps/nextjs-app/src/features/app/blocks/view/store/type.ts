export interface IViewState {
  activeCell?: ICell;
  editingCell?: ICell;
  selection?: [string[], string[]];
}

export interface ICell {
  recordId: string;
  fieldId: string;
}
