import type { IOperationPreviewDto } from '@teable/v2-contract-http/operationPreview';
import { buildFolderDeletePresentation } from './folderDeletePresentation';

type IResourceKind = Extract<
  NonNullable<IOperationPreviewDto['effects'][number]['resource']>,
  { visibility: 'authorized' }
>['kind'];

const ref = (kind: IResourceKind, id: string, name: string) =>
  ({ visibility: 'authorized', kind, id, name }) as const;
const exact = (value: number, unit: string) => ({ basis: 'exact', value, unit }) as const;

const preview = (
  effects: IOperationPreviewDto['effects'],
  blockers: IOperationPreviewDto['blockers'] = []
) =>
  ({
    operation: 'folder.delete',
    outcome: blockers.length ? 'blocked' : 'ready',
    effects,
    blockers,
    warnings: [],
    coverage: { known: [], unknown: [] },
    complexity: null,
    authorization: 'checked',
    observedAt: '2026-11-05T00:00:00.000Z',
    consistency: 'best-effort',
    requestDigest: 'digest',
    implementation: { plannerVersion: 'v1', executionPath: 'path' },
  }) as unknown as IOperationPreviewDto;

describe('buildFolderDeletePresentation', () => {
  const effects: IOperationPreviewDto['effects'] = [
    {
      code: 'folder.delete.item.folder',
      kind: 'resource.trash',
      resource: ref('host', 'bnfRoot', 'Marketing'),
      measures: { shares: exact(1, 'share') },
    },
    {
      code: 'folder.delete.item.table',
      kind: 'resource.trash',
      resource: ref('table', 'tblBudget', 'Budget'),
      measures: { fields: exact(0, 'field') },
    },
    {
      code: 'folder.delete.item.table',
      kind: 'resource.trash',
      resource: ref('table', 'tblLeads', 'Leads'),
      measures: { fields: exact(2, 'field'), shares: exact(1, 'share') },
    },
    {
      code: 'folder.delete.item.dashboard',
      kind: 'resource.permanent-delete',
      resource: ref('host', 'dshBoard', 'Board'),
      measures: {},
    },
    {
      code: 'folder.delete.item.app',
      kind: 'resource.trash',
      resource: ref('app', 'appPortal', 'Portal'),
      measures: {},
    },
    {
      code: 'folder.delete.app.offline',
      kind: 'host.effect',
      resource: ref('app', 'appPortal', 'Portal'),
      relatedResources: [ref('host', 'portal.example.com', 'portal.example.com')],
      measures: {
        publicLinks: exact(1, 'link'),
        customDomains: exact(1, 'domain'),
        loginConfigs: exact(0, 'config'),
      },
    },
    {
      code: 'folder.delete.app_login.disabled',
      kind: 'host.effect',
      resource: ref('app', 'appPortal', 'Portal'),
      relatedResources: [ref('table', 'tblLeads', 'Leads')],
      measures: {},
    },
    {
      code: 'folder.delete.outside_reference.broken',
      kind: 'dependency.change',
      resource: ref('workflow', 'wflNotify', 'Notify'),
      relatedResources: [ref('table', 'tblLeads', 'Leads')],
      measures: { tables: exact(1, 'table') },
    },
  ];

  it('lists what is inside, the items with an impact first, and the folder-level notices', () => {
    const result = buildFolderDeletePresentation(preview(effects));

    expect(result.root?.name).toBe('Marketing');
    expect(result.items.map((item) => item.name)).toEqual(['Leads', 'Board', 'Portal', 'Budget']);
    expect(result.items[2].appOffline).toEqual({
      publicLink: true,
      customDomain: 'portal.example.com',
      loginConfig: false,
    });
    expect(result.counts).toEqual({ table: 2, dashboard: 1, app: 1 });
    expect(result.loginTables).toEqual([
      { tableName: 'Leads', apps: [{ id: 'appPortal', name: 'Portal' }] },
    ]);
    expect(result.outsideReferences).toEqual([
      {
        resourceType: 'workflow',
        id: 'wflNotify',
        name: 'Notify',
        tableNames: ['Leads'],
        uncertain: false,
      },
    ]);
    expect(result.shares).toEqual({ total: 2, names: ['Marketing', 'Leads'] });
  });

  it('marks blocked items and puts them first', () => {
    const result = buildFolderDeletePresentation(
      preview(effects, [
        { code: 'folder.delete.permission_denied', resource: ref('host', 'dshBoard', 'Board') },
      ])
    );

    expect(result.items[0]).toMatchObject({ name: 'Board', blocked: true });
    expect(result.blockedNames).toEqual(['Board']);
  });
});
