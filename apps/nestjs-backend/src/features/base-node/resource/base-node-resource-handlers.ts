import { DashboardNodeHandler } from '../../dashboard/dashboard.node-handler';
import { TableNodeHandler } from '../../table/table.node-handler';
import { FolderNodeHandler } from '../folder/folder.node-handler';

/** Every node kind's handler in the community edition, in the order the tree lists them. */
export const COMMUNITY_BASE_NODE_RESOURCE_HANDLERS = [
  FolderNodeHandler,
  TableNodeHandler,
  DashboardNodeHandler,
];
