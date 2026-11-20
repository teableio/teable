import type { Type } from '@nestjs/common';
import { BaseTrashHandler } from '../../base/base.trash-handler';
import { FolderTrashHandler } from '../../base-node/folder/folder.trash-handler';
import { DashboardTrashHandler } from '../../dashboard/dashboard.trash-handler';
import { SpaceTrashHandler } from '../../space/space.trash-handler';
import { TableTrashHandler } from '../../table/table.trash-handler';
import type { ITrashRecordedHandler } from './trash-resource-handler';

/**
 * Every trash type's handler in the community edition. Emptying a project's trash purges kind by
 * kind in this order: tables first, folders once all they held is gone.
 */
export const COMMUNITY_TRASH_RESOURCE_HANDLERS = [
  TableTrashHandler,
  DashboardTrashHandler,
  FolderTrashHandler,
  SpaceTrashHandler,
  BaseTrashHandler,
];

/** The community kinds whose delete events write their trash entries. */
export const COMMUNITY_TRASH_RECORDED_HANDLERS: Type<ITrashRecordedHandler>[] = [
  SpaceTrashHandler,
  BaseTrashHandler,
  TableTrashHandler,
  DashboardTrashHandler,
];
