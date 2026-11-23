import { LastVisitResourceType, type TrashType } from '@teable/openapi';
import { RESOURCE_DESCRIPTORS } from '../../resource/resource-descriptor';

/** The node kinds besides a table whose last visit a project keeps, as their descriptors say. */
// The table's keys, not `Object.values(TrashType)`: that enum is reverse-mapped.
export const NODE_VISIT_TYPES = (Object.keys(RESOURCE_DESCRIPTORS) as TrashType[]).filter(
  (type) => RESOURCE_DESCRIPTORS[type].lastVisit
) as string[] as LastVisitResourceType[];

/** The node types a project's tree lists; their visits are kept per project. */
export const BASE_NODE_VISIT_TYPES: string[] = [LastVisitResourceType.Table, ...NODE_VISIT_TYPES];
