import { BaseNodeResourceType } from '@teable/openapi';
import { useRouter } from 'next/router';
import { createContext, useContext, useMemo } from 'react';

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

export interface IBaseResourceRoutine extends IBaseResourceBase {
  resourceType: typeof BaseNodeResourceType.Routine;
  routineId: string;
}

export type IBaseResource =
  | IBaseResourceEmpty
  | IBaseResourceTable
  | IBaseResourceDashboard
  | IBaseResourceWorkflow
  | IBaseResourceApp
  | IBaseResourceRoutine;

export type IBaseResourceParsed =
  | Omit<IBaseResourceEmpty, 'baseId'>
  | Omit<IBaseResourceTable, 'baseId'>
  | Omit<IBaseResourceDashboard, 'baseId'>
  | Omit<IBaseResourceWorkflow, 'baseId'>
  | Omit<IBaseResourceApp, 'baseId'>
  | Omit<IBaseResourceRoutine, 'baseId'>;

/**
 * URL:
 * - /base/xxx                           → { resourceType: undefined }
 * - /base/xxx/table/tbl1/viw1           → { resourceType: Table, tableId: 'tbl1', viewId: 'viw1' }
 * - /base/xxx/table/tbl1                → { resourceType: Table, tableId: 'tbl1' }
 * - /base/xxx/dashboard/dsh1            → { resourceType: Dashboard, dashboardId: 'dsh1' }
 * - /base/xxx/automation                → { resourceType: Workflow }
 * - /base/xxx/automation/aut1           → { resourceType: Workflow, workflowId: 'aut1' }
 * - /base/xxx/app/app1                  → { resourceType: App, appId: 'app1' }
 * - /base/xxx/routine/rou1              → { resourceType: Routine, routineId: 'rou1' }
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
    case 'routine':
      return {
        resourceType: BaseNodeResourceType.Routine,
        routineId: id,
      };
    default:
      return { resourceType: undefined };
  }
}

/**
 * Resource pages read their ids from the URL. A host that renders one of them off its route
 * (the chat page's Output pane shows a table, an automation… beside the conversation) provides
 * the ids here instead, and every `useBaseResource()` caller below it follows.
 */
export const BaseResourceOverrideContext = createContext<IBaseResource | undefined>(undefined);

function getBaseResourceId(resource: IBaseResource): string | undefined {
  switch (resource.resourceType) {
    case BaseNodeResourceType.Table:
      return resource.tableId;
    case BaseNodeResourceType.Dashboard:
      return resource.dashboardId;
    case BaseNodeResourceType.Workflow:
      return resource.workflowId;
    case BaseNodeResourceType.App:
      return resource.appId;
    case BaseNodeResourceType.Routine:
      return resource.routineId;
    default:
      return undefined;
  }
}

export function useBaseResource(): IBaseResource {
  const override = useContext(BaseResourceOverrideContext);
  const router = useRouter();
  const { baseId, slug } = router.query;

  return useMemo(() => {
    if (override) return override;
    const parsed = parseBaseSlug(slug as string[] | undefined);
    return {
      baseId: baseId as string,
      ...parsed,
    };
  }, [override, baseId, slug]);
}

export function useBaseNodeId(): string | undefined {
  const override = useContext(BaseResourceOverrideContext);
  const router = useRouter();
  const { slug } = router.query;
  return useMemo(() => {
    if (override) return getBaseResourceId(override);
    if (!slug || slug.length === 0) {
      return;
    }
    return slug?.[1];
  }, [override, slug]);
}
