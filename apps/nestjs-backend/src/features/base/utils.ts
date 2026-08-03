import type { IBaseJson } from '@teable/openapi';

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceExpressionFieldIds(
  expression: string,
  fieldIdMap: { [oldFieldId: string]: string }
): string {
  const regex = /\{([a-z][a-z\d]*)\}/gi;
  return expression.replace(regex, (match, fieldId) => {
    return fieldIdMap[fieldId] ? `{${fieldIdMap[fieldId]}}` : match;
  });
}

export function replaceJsonStringFieldIds(
  jsonString: string | null,
  old2NewFieldMap: { [key: string]: string }
): string | null {
  const regex = /"fld[A-Za-z\d]{16}"/g;
  if (!jsonString) return jsonString;

  return jsonString.replace(regex, (match) => {
    const fieldId = match.slice(1, -1);
    const newFieldId = old2NewFieldMap[fieldId];
    return newFieldId ? `"${newFieldId}"` : match;
  });
}

export function replaceStringByMap(
  config: unknown,
  maps: Record<string, Record<string, string>>
): string | undefined;
export function replaceStringByMap(
  config: unknown,
  maps: Record<string, Record<string, string>>,
  returnJSONString: false
): unknown;
export function replaceStringByMap(
  config: unknown,
  maps: Record<string, Record<string, string>>,
  returnJSONString: boolean = true
): string | undefined | unknown {
  if (!config) {
    return;
  }

  let newConfigStr = JSON.stringify(config);

  for (const [, value] of Object.entries(maps)) {
    if (value) {
      Object.entries(value).forEach(([mapKey, mapValue]) => {
        newConfigStr = newConfigStr.replaceAll(new RegExp(escapeRegExp(mapKey), 'gi'), mapValue);
      });
    }
  }

  return returnJSONString ? newConfigStr : JSON.parse(newConfigStr);
}

/**
 * Recursively replaces every string value stored under a `timeZone` key with the
 * target time zone. In base structures the `timeZone` key only appears in
 * date-related field options (date/formula/rollup formatting) and date view
 * filters, so a deep key-based replacement safely covers all of them.
 */
export function replaceTimeZoneDeep<T>(config: T, timeZone: string): T {
  if (Array.isArray(config)) {
    return config.map((item) => replaceTimeZoneDeep(item, timeZone)) as T;
  }
  if (config !== null && typeof config === 'object') {
    return Object.fromEntries(
      Object.entries(config).map(([key, value]) => [
        key,
        key === 'timeZone' && typeof value === 'string'
          ? timeZone
          : replaceTimeZoneDeep(value, timeZone),
      ])
    ) as T;
  }
  return config;
}

/**
 * Adapts time zones inside workflow definitions (attached to EE structures).
 * Scheduled-time trigger configs store the zone under `tz` (identified by the
 * sibling `timing` key), while date conditions in node configs store it under
 * `timeZone` like view filters do.
 *
 * Literal resolvable nodes (`{ type: 'literal', value: <any> }`) carry
 * user-authored payloads (e.g. HTTP request bodies), so their `value` is left
 * untouched: a `timeZone` key inside has unknown semantics and must not be
 * rewritten.
 */
export function replaceWorkflowTimeZoneDeep<T>(config: T, timeZone: string): T {
  if (Array.isArray(config)) {
    return config.map((item) => replaceWorkflowTimeZoneDeep(item, timeZone)) as T;
  }
  if (config !== null && typeof config === 'object') {
    const record = config as Record<string, unknown>;
    const isScheduleTriggerConfig = typeof record.tz === 'string' && record.timing != null;
    const isLiteralNode = record.type === 'literal' && 'value' in record;
    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => {
        if (isLiteralNode && key === 'value') {
          return [key, value];
        }
        if (key === 'timeZone' && typeof value === 'string') {
          return [key, timeZone];
        }
        if (key === 'tz' && isScheduleTriggerConfig) {
          return [key, timeZone];
        }
        return [key, replaceWorkflowTimeZoneDeep(value, timeZone)];
      })
    ) as T;
  }
  return config;
}

/**
 * Adapts date-related time zones in a duplicated base structure to the given
 * time zone, so that bases created from templates display and compute dates in
 * the current user's environment instead of the template author's.
 */
export function adaptStructureTimeZone(structure: IBaseJson, timeZone: string): IBaseJson {
  const adapted: IBaseJson = {
    ...structure,
    tables: structure.tables.map((table) => ({
      ...table,
      fields: replaceTimeZoneDeep(table.fields, timeZone),
      views: replaceTimeZoneDeep(table.views, timeZone),
    })),
  };

  // EE structures extend IBaseJson with automation workflows whose scheduled
  // triggers and date conditions also carry the template author's time zone.
  // Only node configs are rewritten: testResult may cache arbitrary external
  // API responses where a `timeZone` key has unknown semantics.
  const workflows = (structure as { workflows?: unknown }).workflows;
  if (Array.isArray(workflows)) {
    (adapted as { workflows?: unknown }).workflows = workflows.map((workflow) => {
      const nodes = (workflow as { nodes?: unknown }).nodes;
      if (!Array.isArray(nodes)) {
        return workflow;
      }
      return {
        ...workflow,
        nodes: nodes.map((node) => ({
          ...node,
          config: replaceWorkflowTimeZoneDeep((node as { config?: unknown }).config, timeZone),
        })),
      };
    });
  }

  return adapted;
}

export const replaceDefaultUrl = (
  defaultUrl: string,
  maps: Record<string, Record<string, string>>
) => {
  if (!defaultUrl) return defaultUrl;

  let newDefaultUrl = defaultUrl;

  for (const [, value] of Object.entries(maps)) {
    if (value) {
      Object.entries(value).forEach(([mapKey, mapValue]) => {
        newDefaultUrl = newDefaultUrl.replaceAll(mapKey, mapValue);
      });
    }
  }

  return newDefaultUrl;
};

export interface ILinkFieldTableInfo {
  dbFieldName: string;
  selfKeyName: string;
  isMultipleCellValue: boolean;
}

export type ILinkFieldTableMap = Record<string, ILinkFieldTableInfo[]>;

export const mergeLinkFieldTableMaps = (
  map1: ILinkFieldTableMap,
  map2: ILinkFieldTableMap
): ILinkFieldTableMap => {
  const merged = { ...map1 };
  Object.entries(map2).forEach(([tableId, fields]) => {
    merged[tableId] = [...(merged[tableId] || []), ...fields];
  });
  return merged;
};
