import { ResourceType } from '@teable/openapi';

export interface IViewTrashRow {
  id: string;
  tableId: string;
  createdBy: string;
  resourceType: ResourceType.View;
  snapshot: string;
  createdTime?: Date;
}

export const buildViewTrashRow = (input: {
  operationId: string;
  tableId: string;
  viewId: string;
  userId: string;
  createdTime?: Date;
}): IViewTrashRow => ({
  id: input.operationId,
  tableId: input.tableId,
  createdBy: input.userId,
  resourceType: ResourceType.View,
  snapshot: JSON.stringify([input.viewId]),
  ...(input.createdTime ? { createdTime: input.createdTime } : {}),
});
