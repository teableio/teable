export interface IStackData {
  id: string;
  data: unknown;
  count: number;
}

export interface IKanbanPermission {
  stackCreatable: boolean;
  stackEditable: boolean;
  stackDeletable: boolean;
  stackDraggable: boolean;
  cardCreatable: boolean;
  cardEditable: boolean;
  cardDeletable: boolean;
  cardDraggable: boolean;
}
