import type { BaseNodeResourceType } from '@teable/openapi';
import type { IOperationPreviewDto } from '@teable/v2-contract-http/operationPreview';

type PreviewEffect = IOperationPreviewDto['effects'][number];
type PreviewResource = NonNullable<PreviewEffect['resource']>;

const ITEM_PREFIX = 'folder.delete.item.';

export interface IFolderDeleteListItem {
  key: string;
  resourceType: BaseNodeResourceType;
  /** Absent when the item is hidden from the viewer. */
  resourceId?: string;
  name?: string;
  permanent: boolean;
  fieldCount: number;
  /** The table's own preview showed only some of its field effects: `fieldCount` is a minimum. */
  fieldCountAtLeast: boolean;
  shareCount: number;
  appOffline?: { publicLink: boolean; customDomain?: string; loginConfig: boolean };
  blocked: boolean;
  /** Field effects of a table, or the app going offline: what the list sorts and badges by. */
  impactCount: number;
}

export interface IFolderDeletePresentation {
  root?: IFolderDeleteListItem;
  /** Everything inside the folder, the items with an impact first. */
  items: IFolderDeleteListItem[];
  counts: Partial<Record<BaseNodeResourceType, number>>;
  loginTables: { tableName: string; apps: { id: string; name: string }[] }[];
  outsideReferences: {
    resourceType: string;
    id: string;
    name: string;
    tableNames: string[];
    uncertain: boolean;
  }[];
  shares: { total: number; names: string[] };
  blockedNames: string[];
  unreadAppNames: string[];
}

const exactValue = (effect: PreviewEffect, key: string) => {
  const measure = effect.measures[key];
  return measure?.basis === 'exact' ? measure.value : 0;
};

/** An exact count, or the lower bound of a range (the item has at least that many). */
const minimumValue = (effect: PreviewEffect, key: string) => {
  const measure = effect.measures[key];
  if (measure?.basis === 'range') return measure.lower ?? 0;
  return exactValue(effect, key);
};

const authorized = (resource: PreviewResource | undefined) =>
  resource?.visibility === 'authorized' ? resource : undefined;

const resourceName = (resource: PreviewResource | undefined) => authorized(resource)?.name ?? '';

const toItem = (effect: PreviewEffect, index: number): IFolderDeleteListItem => {
  const resource = authorized(effect.resource);
  return {
    key: resource?.id ?? `hidden-${index}`,
    resourceType: effect.code.slice(ITEM_PREFIX.length) as BaseNodeResourceType,
    resourceId: resource?.id,
    name: resource?.name,
    permanent: effect.kind === 'resource.permanent-delete',
    fieldCount: minimumValue(effect, 'fields'),
    fieldCountAtLeast: effect.measures.fields?.basis === 'range',
    shareCount: exactValue(effect, 'shares'),
    blocked: false,
    impactCount: minimumValue(effect, 'fields'),
  };
};

const toAppOffline = (effect: PreviewEffect): IFolderDeleteListItem['appOffline'] => ({
  publicLink: exactValue(effect, 'publicLinks') > 0,
  customDomain: resourceName(effect.relatedResources?.[0]) || undefined,
  loginConfig: exactValue(effect, 'loginConfigs') > 0,
});

const collectLoginTables = (effects: PreviewEffect[]) => {
  const byTable = new Map<string, IFolderDeletePresentation['loginTables'][number]>();
  for (const effect of effects) {
    const app = authorized(effect.resource);
    const table = authorized(effect.relatedResources?.[0]);
    if (effect.code !== 'folder.delete.app_login.disabled' || !app || !table) continue;
    const entry = byTable.get(table.id) ?? { tableName: table.name ?? '', apps: [] };
    entry.apps.push({ id: app.id, name: app.name ?? '' });
    byTable.set(table.id, entry);
  }
  return [...byTable.values()];
};

const collectOutsideReferences = (
  effects: PreviewEffect[]
): IFolderDeletePresentation['outsideReferences'] =>
  effects.flatMap((effect) => {
    const resource = authorized(effect.resource);
    if (!effect.code.startsWith('folder.delete.outside_reference.') || !resource) return [];
    return [
      {
        resourceType: resource.kind,
        id: resource.id,
        name: resource.name ?? '',
        tableNames: (effect.relatedResources ?? []).map(resourceName).filter(Boolean),
        uncertain: effect.code.endsWith('.possible'),
      },
    ];
  });

// Blocked items first, then the ones with something to say, then the rest.
const rank = (item: IFolderDeleteListItem) =>
  item.blocked ? 2 : item.impactCount > 0 || item.permanent ? 1 : 0;

/** Groups a folder.delete preview into the dialog's list, detail and folder-level notices. */
export const buildFolderDeletePresentation = (
  preview: IOperationPreviewDto
): IFolderDeletePresentation => {
  const effects = [...preview.effects];
  const items = effects.flatMap((effect, index) =>
    effect.code.startsWith(ITEM_PREFIX) ? [toItem(effect, index)] : []
  );
  const byResourceId = new Map(
    items.flatMap((item) => (item.resourceId ? [[item.resourceId, item] as const] : []))
  );
  for (const effect of effects) {
    const app = byResourceId.get(authorized(effect.resource)?.id ?? '');
    if (effect.code !== 'folder.delete.app.offline' || !app) continue;
    app.appOffline = toAppOffline(effect);
    app.impactCount += 1;
  }
  const blockedNames: string[] = [];
  for (const blocker of preview.blockers) {
    const item = byResourceId.get(authorized(blocker.resource)?.id ?? '');
    if (item) item.blocked = true;
    const name = resourceName(blocker.resource);
    if (name && !blockedNames.includes(name)) blockedNames.push(name);
  }

  const [root, ...inside] = items;
  const counts: IFolderDeletePresentation['counts'] = {};
  for (const item of inside) counts[item.resourceType] = (counts[item.resourceType] ?? 0) + 1;
  const shared = items.filter((item) => item.shareCount > 0);

  return {
    root,
    // Array.prototype.sort is stable, so the tree order holds within each group.
    items: [...inside].sort((a, b) => rank(b) - rank(a)),
    counts,
    loginTables: collectLoginTables(effects),
    outsideReferences: collectOutsideReferences(effects),
    shares: {
      total: shared.reduce((total, item) => total + item.shareCount, 0),
      names: shared.map((item) => item.name ?? '').filter(Boolean),
    },
    blockedNames,
    unreadAppNames: preview.warnings
      .filter((warning) => warning.code === 'folder.delete.app_source_unread')
      .map((warning) => resourceName(warning.resource))
      .filter(Boolean),
  };
};
