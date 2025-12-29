/* eslint-disable sonarjs/no-duplicate-string */
import type { TableAction, AppAction, AutomationAction } from '@teable/core';
import { HttpErrorCode } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import type { IBaseNodePermissionContext } from './types';
import { BaseNodeAction } from './types';

const map: Record<BaseNodeResourceType, Record<BaseNodeAction, string>> = {
  [BaseNodeResourceType.Folder]: {
    [BaseNodeAction.Read]: 'base|read',
    [BaseNodeAction.Create]: 'base|update',
    [BaseNodeAction.Update]: 'base|update',
    [BaseNodeAction.Delete]: 'base|update',
  },
  [BaseNodeResourceType.Table]: {
    [BaseNodeAction.Read]: 'table|read',
    [BaseNodeAction.Create]: 'table|create',
    [BaseNodeAction.Update]: 'table|update',
    [BaseNodeAction.Delete]: 'table|delete',
  },
  [BaseNodeResourceType.Dashboard]: {
    [BaseNodeAction.Read]: 'base|read',
    [BaseNodeAction.Create]: 'base|update',
    [BaseNodeAction.Update]: 'base|update',
    [BaseNodeAction.Delete]: 'base|update',
  },
  [BaseNodeResourceType.Workflow]: {
    [BaseNodeAction.Read]: 'automation|read',
    [BaseNodeAction.Create]: 'automation|create',
    [BaseNodeAction.Update]: 'automation|update',
    [BaseNodeAction.Delete]: 'automation|delete',
  },
  [BaseNodeResourceType.App]: {
    [BaseNodeAction.Read]: 'app|read',
    [BaseNodeAction.Create]: 'app|create',
    [BaseNodeAction.Update]: 'app|update',
    [BaseNodeAction.Delete]: 'app|delete',
  },
};

export const checkBaseNodePermission = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  action: BaseNodeAction,
  permissionContext: IBaseNodePermissionContext
): boolean => {
  const { resourceType } = node;
  const { resourceId } = node;
  const { tablePermissionMap, permissionSet, appPermissionMap, workflowPermissionMap } =
    permissionContext;
  const checkAction = map[resourceType][action];
  if (resourceType === BaseNodeResourceType.Table && tablePermissionMap) {
    return tablePermissionMap[resourceId]?.includes(checkAction as TableAction) ?? false;
  }
  if (resourceType === BaseNodeResourceType.App && appPermissionMap) {
    return appPermissionMap[resourceId]?.includes(checkAction as AppAction) ?? false;
  }
  if (resourceType === BaseNodeResourceType.Workflow && workflowPermissionMap) {
    return workflowPermissionMap[resourceId]?.includes(checkAction as AutomationAction) ?? false;
  }
  return permissionSet.has(checkAction);
};

export const checkBaseNodePermissionCreate = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  baseNodePermissions: BaseNodeAction[],
  permissionContext: IBaseNodePermissionContext
): boolean => {
  const checkCreate = baseNodePermissions.includes(BaseNodeAction.Create);
  if (!checkCreate) {
    return true;
  }
  const { resourceType } = node;
  if (!resourceType) {
    throw new CustomHttpException(
      'Cannot create base node with empty resource type',
      HttpErrorCode.VALIDATION_ERROR,
      {
        localization: {
          i18nKey: 'httpErrors.baseNode.invalidResourceType',
        },
      }
    );
  }

  return checkBaseNodePermission(node, BaseNodeAction.Create, permissionContext);
};
