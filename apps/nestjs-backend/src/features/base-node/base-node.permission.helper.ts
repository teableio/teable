/* eslint-disable sonarjs/no-duplicate-string */
import { HttpErrorCode } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
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
    [BaseNodeAction.Read]: 'base|read',
    [BaseNodeAction.Create]: 'base|update',
    [BaseNodeAction.Update]: 'base|update',
    [BaseNodeAction.Delete]: 'base|update',
  },
};

export const checkBaseNodePermission = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  action: BaseNodeAction,
  permissionContext: {
    tablePermissionMap?: Record<string, string[]>;
    permissionSet: Set<string>;
  }
): boolean => {
  const { resourceType } = node;
  const { resourceId } = node;
  const { tablePermissionMap, permissionSet } = permissionContext;
  const checkAction = map[resourceType][action];
  if (resourceType === BaseNodeResourceType.Table && tablePermissionMap) {
    return tablePermissionMap[resourceId]?.includes(checkAction) ?? false;
  }
  return permissionSet.has(checkAction);
};

export const checkBaseNodePermissionCreate = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  baseNodePermissions: BaseNodeAction[],
  permissionContext: {
    tablePermissionMap?: Record<string, string[]>;
    permissionSet: Set<string>;
  }
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
