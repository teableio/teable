import type { ViewAction } from '@teable/core';
import type { ViewOperationPluginContext, ViewOperationPayloadViewConfig } from '@teable/v2-core';

const shareKeys: Record<string, true> = { enableShare: true, shareId: true, shareMeta: true };

/** Classify the persisted operation, including sharing introduced during create/restore. */
export const resolveViewOperationPermissionActions = (context: ViewOperationPluginContext): ViewAction[] => {
  if (context.kind === 'delete') return ['view|delete'];
  const config: ViewOperationPayloadViewConfig = context.kind === 'update' ? context.payload.patch : context.payload.view;
  const keys = Object.keys(config).filter((key) => context.kind === 'update' || config[key as keyof ViewOperationPayloadViewConfig] !== undefined);
  const shares = context.kind === 'update'
    ? keys.some((key) => Object.hasOwn(shareKeys, key))
    : config.enableShare === true || config.shareId !== undefined ||
      ((context.kind !== 'create' || context.payload.source !== 'snapshotRestore') &&
        config.shareMeta !== undefined);
  if (context.kind === 'update') {
    return [...(keys.some((key) => !Object.hasOwn(shareKeys, key)) || !shares ? ['view|update' as const] : []),
      ...(shares ? ['view|share' as const] : [])];
  }
  return ['view|create', ...(context.kind === 'duplicate' ? ['view|read' as const] : []),
    ...(shares ? ['view|share' as const] : [])];
};

export interface IViewMetadataVisibility {
  readonly canShare: boolean;
  /** Undefined means all fields are readable. Empty means none are readable. */
  readonly readableFieldIds?: ReadonlySet<string>;
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Opaque options may embed field dependencies; drop a component if any dependency is denied. */
const hasDeniedReference = (value: unknown, readable: ReadonlySet<string>): boolean => {
  if (typeof value === 'string') {
    return (value.match(/fld[A-Za-z0-9]{16}/g) ?? []).some((id) => !readable.has(id));
  }
  if (Array.isArray(value)) return value.some((item) => hasDeniedReference(item, readable));
  const entry = object(value);
  return !!entry && Object.entries(entry).some(([key, item]) =>
    hasDeniedReference(key, readable) || (key === 'fieldId' && typeof item === 'string' && !readable.has(item)) || hasDeniedReference(item, readable));
};

/** Sanitize a full view DTO or the data of a historical view snapshot in place. */
export const redactViewMetadata = (value: unknown, visibility: IViewMetadataVisibility): void => {
  const view = object(value);
  if (!view) return;
  if (!visibility.canShare) {
    delete view.shareId;
    delete view.shareMeta;
  }
  const readable = visibility.readableFieldIds;
  if (!readable) return;
  const columnMeta = object(view.columnMeta);
  if (columnMeta) view.columnMeta = Object.fromEntries(Object.entries(columnMeta).filter(([id]) => readable.has(id)));
  for (const key of ['filter', 'sort', 'group', 'options', 'sourceFilter']) {
    if (readable.size === 0 || hasDeniedReference(view[key], readable)) delete view[key];
  }
};

/** Retain a local field's persisted error state without exposing its dependency configuration. */
const redactErroredFieldDependencies = (field: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (field.hasError !== true || (field.isLookup !== true && field.type !== 'formula' &&
    field.type !== 'rollup' && field.type !== 'conditionalRollup')) return undefined;
  const projected = { ...field };
  for (const key of ['options', 'lookupOptions', 'conditionalLookupOptions', 'config', 'computeMeta']) delete projected[key];
  return projected;
};

/** Native lookup/link/rollup DTOs share the same authorized foreign-table boundary. */
export const projectReadableFieldMetadata = async (
  fields: readonly unknown[],
  canReadDependency: (tableId: string) => Promise<boolean>
): Promise<Record<string, unknown>[]> => {
  const readable: Record<string, unknown>[] = [];
  const omitted = new Set<string>();
  for (const item of fields) {
    const field = object(item);
    if (!field) continue;
    let allowed = true;
    for (const key of ['options', 'lookupOptions', 'conditionalLookupOptions', 'config']) {
      const config = object(field[key]);
      if (typeof config?.foreignTableId === 'string' && !await canReadDependency(config.foreignTableId)) {
        allowed = false;
        break;
      }
    }
    if (allowed) readable.push(field);
    else {
      const projected = redactErroredFieldDependencies(field);
      if (projected) readable.push(projected);
      else if (typeof field.id === 'string') omitted.add(field.id);
    }
  }
  // Omitted source links/formulas cannot leave their local dependency identifiers behind.
  for (let index = 0; index < readable.length;) {
    const field = readable[index];
    const localReferences = [object(field.lookupOptions)?.linkFieldId, object(field.config)?.linkFieldId];
    const expression = object(field.options)?.expression;
    if (typeof expression === 'string') localReferences.push(...expression.match(/fld[A-Za-z0-9]{16}/g) ?? []);
    if (localReferences.some((id) => typeof id === 'string' && omitted.has(id))) {
      const projected = redactErroredFieldDependencies(field);
      if (projected) {
        readable[index] = projected;
        index++;
        continue;
      }
      if (typeof field.id === 'string') omitted.add(field.id);
      readable.splice(index, 1);
      index = 0;
    } else index++;
  }
  return readable;
};
