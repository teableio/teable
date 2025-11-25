import type { UrlObject } from 'url';
import { Table2 } from '@teable/icons';
import { BaseNodeResourceType } from '@teable/openapi';
import { AppWindowMacIcon, BotIcon, CircleGaugeIcon, FolderClosedIcon } from 'lucide-react';

export const ROOT_ID = '__root__';

export const BaseNodeResourceIconMap = {
  [BaseNodeResourceType.Folder]: FolderClosedIcon,
  [BaseNodeResourceType.Dashboard]: CircleGaugeIcon,
  [BaseNodeResourceType.Workflow]: BotIcon,
  [BaseNodeResourceType.App]: AppWindowMacIcon,
  [BaseNodeResourceType.Table]: Table2,
};

export const getNodeUrl = (props: {
  baseId: string;
  resourceType: BaseNodeResourceType;
  resourceId: string;
  viewId?: string;
}): UrlObject => {
  const { baseId, resourceId, resourceType, viewId } = props;
  switch (resourceType) {
    case BaseNodeResourceType.Table:
      return { pathname: `/base/${baseId}/table/${resourceId}/${viewId}` };
    case BaseNodeResourceType.Dashboard:
      return { pathname: `/base/${baseId}/dashboard/${resourceId}` };
    case BaseNodeResourceType.Workflow:
      return { pathname: `/base/${baseId}/automation/${resourceId}` };
    case BaseNodeResourceType.App:
      return { pathname: `/base/${baseId}/app/${resourceId}` };
    default:
      return { pathname: `/base/${baseId}` };
  }
};

export const parseNodeUrl = (props: {
  baseId: string;
  url: string;
  urlParams: {
    dashboardId?: string;
    automationId?: string;
    appId?: string;
    tableId?: string;
  };
}) => {
  const { baseId, url, urlParams } = props;
  const { dashboardId, automationId, appId, tableId } = urlParams;
  if (url.includes(`/base/${baseId}/dashboard/${dashboardId}`)) {
    return {
      resourceType: BaseNodeResourceType.Dashboard,
      resourceId: dashboardId,
    };
  }
  if (url.includes(`/base/${baseId}/automation/${automationId}`)) {
    return {
      resourceType: BaseNodeResourceType.Workflow,
      resourceId: automationId,
    };
  }
  if (url.includes(`/base/${baseId}/app/${appId}`)) {
    return {
      resourceType: BaseNodeResourceType.App,
      resourceId: appId,
    };
  }
  if (url.includes(`/base/${baseId}/table/${tableId}`)) {
    return {
      resourceType: BaseNodeResourceType.Table,
      resourceId: tableId,
    };
  }
  return null;
};

export const cleanParentId = (parentId?: string | null) => {
  if (parentId === ROOT_ID) {
    return null;
  }
  return parentId;
};
