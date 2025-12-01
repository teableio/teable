/* eslint-disable sonarjs/no-duplicate-string */
import { HttpErrorCode, type BaseNodeAction } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';

const checkBaseNodeRead = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  permissionContext: {
    permissionSet: Set<string>;
    tablePermissionMap?: Record<string, string[]>;
  }
): boolean => {
  const { permissionSet, tablePermissionMap } = permissionContext;
  const { resourceType, resourceId } = node;
  if (resourceType === BaseNodeResourceType.Folder) {
    return permissionSet.has('base|read');
  }
  if (resourceType === BaseNodeResourceType.Table) {
    if (tablePermissionMap) {
      return tablePermissionMap[resourceId]?.includes('table|read') ?? false;
    }
    return permissionSet.has('table|read');
  }
  if (resourceType === BaseNodeResourceType.Dashboard) {
    return permissionSet.has('base|read');
  }
  if (resourceType === BaseNodeResourceType.Workflow) {
    return permissionSet.has('automation|read');
  }
  if (resourceType === BaseNodeResourceType.App) {
    return permissionSet.has('base|read');
  }
  return true;
};

const checkBaseNodeCreate = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  permissionContext: {
    permissionSet: Set<string>;
    tablePermissionMap?: Record<string, string[]>;
  }
): boolean => {
  const { permissionSet } = permissionContext;
  const { resourceType } = node;
  if (resourceType === BaseNodeResourceType.Folder) {
    return permissionSet.has('base|update');
  }
  if (resourceType === BaseNodeResourceType.Table) {
    return permissionSet.has('table|create');
  }
  if (resourceType === BaseNodeResourceType.Dashboard) {
    return permissionSet.has('base|update');
  }
  if (resourceType === BaseNodeResourceType.Workflow) {
    return permissionSet.has('automation|create');
  }
  if (resourceType === BaseNodeResourceType.App) {
    return permissionSet.has('base|update');
  }
  return true;
};

const checkBaseNodeUpdate = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  permissionContext: {
    tablePermissionMap?: Record<string, string[]>;
    permissionSet: Set<string>;
  }
): boolean => {
  const { permissionSet, tablePermissionMap } = permissionContext;
  const { resourceType, resourceId } = node;
  if (resourceType === BaseNodeResourceType.Folder) {
    return permissionSet.has('base|update');
  }
  if (resourceType === BaseNodeResourceType.Table) {
    if (tablePermissionMap) {
      return tablePermissionMap[resourceId]?.includes('table|update') ?? false;
    }
    return permissionSet.has('table|update');
  }
  if (resourceType === BaseNodeResourceType.Dashboard) {
    return permissionSet.has('base|update');
  }
  if (resourceType === BaseNodeResourceType.Workflow) {
    return permissionSet.has('automation|update');
  }
  if (resourceType === BaseNodeResourceType.App) {
    return permissionSet.has('base|update');
  }
  return true;
};

const checkBaseNodeDelete = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  permissionContext: {
    tablePermissionMap?: Record<string, string[]>;
    permissionSet: Set<string>;
  }
): boolean => {
  const { permissionSet, tablePermissionMap } = permissionContext;
  const { resourceType, resourceId } = node;
  if (resourceType === BaseNodeResourceType.Folder) {
    return permissionSet.has('base|update');
  }
  if (resourceType === BaseNodeResourceType.Table) {
    if (tablePermissionMap) {
      return tablePermissionMap[resourceId]?.includes('table|delete') ?? false;
    }
    return permissionSet.has('table|delete');
  }
  if (resourceType === BaseNodeResourceType.Dashboard) {
    return permissionSet.has('base|update');
  }
  if (resourceType === BaseNodeResourceType.Workflow) {
    return permissionSet.has('automation|delete');
  }
  if (resourceType === BaseNodeResourceType.App) {
    return permissionSet.has('base|update');
  }
  return true;
};

export const checkBaseNodePermission = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  action: BaseNodeAction,
  permissionContext: {
    tablePermissionMap?: Record<string, string[]>;
    permissionSet: Set<string>;
  }
): boolean => {
  switch (action) {
    case 'base_node|read':
      return checkBaseNodeRead(node, permissionContext);
    case 'base_node|create':
      return checkBaseNodeCreate(node, permissionContext);
    case 'base_node|update':
      return checkBaseNodeUpdate(node, permissionContext);
    case 'base_node|delete':
      return checkBaseNodeDelete(node, permissionContext);
    default:
      return false;
  }
};

export const checkBaseNodePermissionCreate = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  baseNodePermissions: BaseNodeAction[],
  permissionContext: {
    tablePermissionMap?: Record<string, string[]>;
    permissionSet: Set<string>;
  }
): boolean => {
  const checkCreate = baseNodePermissions.includes('base_node|create');
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

  return checkBaseNodePermission(node, 'base_node|create', permissionContext);
};
