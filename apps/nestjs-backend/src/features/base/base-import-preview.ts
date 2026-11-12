import type {
  BaseNodeResourceType,
  IBaseJson,
  IImportBasePreviewNode,
  IImportBasePreviewVo,
} from '@teable/openapi';

export interface IImportPreviewResources {
  type: BaseNodeResourceType;
  items: { id: string; name: string }[];
}

/**
 * The resources of one type found in a structure array. The structure is
 * user-supplied, so a missing or malformed array counts as empty instead of
 * failing the preview.
 */
export const toImportPreviewResources = (
  type: BaseNodeResourceType,
  items: unknown
): IImportPreviewResources => {
  const list = Array.isArray(items) ? items : [];
  return {
    type,
    items: list.map((item, index) => {
      const { id, name } = (item ?? {}) as { id?: unknown; name?: unknown };
      return {
        id: typeof id === 'string' ? id : `${type}:${index}`,
        name: typeof name === 'string' ? name : '',
      };
    }),
  };
};

type IPlacedNode = IImportBasePreviewNode & { order: number };

const resourceKey = (type: unknown, id: unknown) => `${String(type)}:${String(id)}`;

/**
 * A node whose parent is missing goes to the root, as the import does. A parent
 * loop only exists in a hand-edited archive; nodes are detached one at a time,
 * so the first member reached is cut loose and the rest keep their place under it.
 */
const detachUnreachableParents = (nodes: IPlacedNode[]) => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const seen = new Set([node.id]);
    let parent = node.parentId ? nodeById.get(node.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      if (!parent.parentId) break;
      parent = nodeById.get(parent.parentId);
    }
    const reachesRoot = parent !== undefined && !parent.parentId;
    if (node.parentId && !reachesRoot) node.parentId = null;
  }
};

/**
 * Lay the resources out the way the import will: under the folders recorded in
 * `structure.nodes`, in their order. A resource without a node (archives older
 * than the node tree) goes to the root.
 */
const buildPreviewNodes = (
  structure: IBaseJson,
  resources: IImportPreviewResources[]
): IImportBasePreviewNode[] => {
  const all = resources.flatMap(({ type, items }) =>
    items.map(({ id, name }) => ({ key: resourceKey(type, id), type, name }))
  );
  const resourceByKey = new Map(all.map((resource) => [resource.key, resource]));

  const placedKeys = new Set<string>();
  const placed: IPlacedNode[] = [];
  for (const node of Array.isArray(structure.nodes) ? structure.nodes : []) {
    const resource = resourceByKey.get(resourceKey(node?.resourceType, node?.resourceId));
    if (!resource || placedKeys.has(resource.key) || typeof node.id !== 'string') continue;
    placedKeys.add(resource.key);
    placed.push({
      id: node.id,
      parentId: typeof node.parentId === 'string' ? node.parentId : null,
      type: resource.type,
      name: resource.name,
      order: typeof node.order === 'number' ? node.order : Number.MAX_SAFE_INTEGER,
    });
  }
  detachUnreachableParents(placed);
  placed.sort((a, b) => a.order - b.order);

  const unplaced = all
    .filter(({ key }) => !placedKeys.has(key))
    .map(({ key, type, name }) => ({ id: key, parentId: null, type, name }));

  return [...placed.map(({ order: _order, ...node }) => node), ...unplaced];
};

export const buildImportBasePreview = (
  structure: IBaseJson,
  resources: IImportPreviewResources[]
): IImportBasePreviewVo => {
  const groups = resources
    .filter(({ items }) => items.length > 0)
    .map(({ type, items }) => ({ type, count: items.length }));
  return {
    name: typeof structure.name === 'string' ? structure.name : null,
    groups,
    nodes: buildPreviewNodes(structure, resources),
  };
};
