import type { AffectedItem } from './types';

type WorkflowNodeNameResolver = (type: string, category: string) => string;

export const getAffectedItemDisplayName = (
  item: AffectedItem,
  getWorkflowNodeTypeName: WorkflowNodeNameResolver
) => {
  if (item.itemType !== 'workflow' || item.name) {
    return item.name;
  }

  return getWorkflowNodeTypeName(item.type as string, item.category as string);
};
