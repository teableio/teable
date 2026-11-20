import { BaseNodeResourceType } from '@teable/openapi';
import type { IBaseNodeVo, IDeleteBaseNodeVo } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { Events } from '../event.enum';
import { BaseNodeEventFactory } from './base-node.event';

describe('BaseNodeEventFactory', () => {
  const context = {};
  const node = (resourceType: BaseNodeResourceType) =>
    ({ resourceType, resourceId: 'resA', resourceMeta: { name: 'A' } }) as unknown as IBaseNodeVo;

  it.each([
    [BaseNodeResourceType.Folder, 'folder', Events.BASE_FOLDER_CREATE],
    [BaseNodeResourceType.Dashboard, 'dashboard', Events.DASHBOARD_CREATE],
    [BaseNodeResourceType.Workflow, 'workflow', Events.WORKFLOW_CREATE],
    [BaseNodeResourceType.App, 'app', Events.APP_CREATE],
    [BaseNodeResourceType.Routine, 'routine', Events.ROUTINE_CREATE],
  ])('raises a %s node create as its own event', (type, key, name) => {
    const event = BaseNodeEventFactory.create(
      Events.BASE_NODE_CREATE,
      { baseId: 'bseA', node: node(type) },
      context
    );

    expect(event?.name).toBe(name);
    expect(event?.payload).toEqual({ baseId: 'bseA', [key]: { id: 'resA', name: 'A' } });
  });

  it.each([
    [
      BaseNodeResourceType.Dashboard,
      { dashboardId: 'resA', permanent: true },
      Events.DASHBOARD_DELETE,
    ],
    [
      BaseNodeResourceType.Workflow,
      { workflowId: 'resA', permanent: true },
      Events.WORKFLOW_DELETE,
    ],
    [BaseNodeResourceType.App, { appId: 'resA', permanent: true }, Events.APP_DELETE],
    [BaseNodeResourceType.Routine, { routineId: 'resA', permanent: true }, Events.ROUTINE_DELETE],
    // A folder's delete event never carried `permanent`
    [BaseNodeResourceType.Folder, { folderId: 'resA' }, Events.BASE_FOLDER_DELETE],
  ])('raises a %s node delete as its own event', (type, ids, name) => {
    const event = BaseNodeEventFactory.create(
      Events.BASE_NODE_DELETE,
      {
        baseId: 'bseA',
        node: { resourceType: type, resourceId: 'resA', permanent: true } as IDeleteBaseNodeVo,
      },
      context
    );

    expect(event?.name).toBe(name);
    expect(event?.payload).toEqual({ baseId: 'bseA', ...ids });
  });

  it("leaves a table's events to its ops", () => {
    expect(
      BaseNodeEventFactory.create(
        Events.BASE_NODE_UPDATE,
        { baseId: 'bseA', node: node(BaseNodeResourceType.Table) },
        context
      )
    ).toBeNull();
  });
});
