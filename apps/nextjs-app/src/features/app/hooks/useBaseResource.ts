import { BaseNodeResourceType } from '@teable/openapi';
import { useRouter } from 'next/router';
import { useMemo } from 'react';

interface IBaseResourceBase {
  baseId: string;
}

interface IBaseResourceEmpty extends IBaseResourceBase {
  resourceType?: undefined;
}

export interface IBaseResourceTable extends IBaseResourceBase {
  resourceType: typeof BaseNodeResourceType.Table;
  tableId: string;
  viewId: string;
}

export interface IBaseResourceDashboard extends IBaseResourceBase {
  resourceType: typeof BaseNodeResourceType.Dashboard;
  dashboardId: string;
}

export interface IBaseResourceWorkflow extends IBaseResourceBase {
  resourceType: typeof BaseNodeResourceType.Workflow;
  workflowId: string;
}

export interface IBaseResourceApp extends IBaseResourceBase {
  resourceType: typeof BaseNodeResourceType.App;
  appId: string;
}

export type IBaseResource =
  | IBaseResourceEmpty
  | IBaseResourceTable
  | IBaseResourceDashboard
  | IBaseResourceWorkflow
  | IBaseResourceApp;

export type IBaseResourceParsed =
  | Omit<IBaseResourceEmpty, 'baseId'>
  | Omit<IBaseResourceTable, 'baseId'>
  | Omit<IBaseResourceDashboard, 'baseId'>
  | Omit<IBaseResourceWorkflow, 'baseId'>
  | Omit<IBaseResourceApp, 'baseId'>;

/**
 * URL:
 * - /base/xxx                           → { resourceType: undefined }
 * - /base/xxx/table/tbl1/viw1           → { resourceType: Table, tableId: 'tbl1', viewId: 'viw1' }
 * - /base/xxx/table/tbl1                → { resourceType: Table, tableId: 'tbl1' }
 * - /base/xxx/dashboard/dsh1            → { resourceType: Dashboard, dashboardId: 'dsh1' }
 * - /base/xxx/automation                → { resourceType: Workflow }
 * - /base/xxx/automation/aut1           → { resourceType: Workflow, workflowId: 'aut1' }
 * - /base/xxx/app/app1                  → { resourceType: App, appId: 'app1' }
 *
 * Note: Legacy URLs like /base/xxx/tbl1/viw1 are redirected to /base/xxx/table/tbl1/viw1 in getServerSideProps
 */
export function parseBaseSlug(slug?: string[]): IBaseResourceParsed {
  if (!slug || slug.length === 0) {
    return { resourceType: undefined };
  }

  const [type, id, extra] = slug;

  switch (type) {
    case 'table':
      return {
        resourceType: BaseNodeResourceType.Table,
        tableId: id,
        viewId: extra,
      };
    case 'dashboard':
      return {
        resourceType: BaseNodeResourceType.Dashboard,
        dashboardId: id,
      };
    case 'automation':
      return {
        resourceType: BaseNodeResourceType.Workflow,
        workflowId: id,
      };
    case 'app':
      return {
        resourceType: BaseNodeResourceType.App,
        appId: id,
      };
    default:
      return { resourceType: undefined };
  }
}

export function useBaseResource(): IBaseResource {
  const router = useRouter();
  const { baseId, slug } = router.query;

  return useMemo(() => {
    const parsed = parseBaseSlug(slug as string[] | undefined);
    return {
      baseId: baseId as string,
      ...parsed,
    };
  }, [baseId, slug]);
}
