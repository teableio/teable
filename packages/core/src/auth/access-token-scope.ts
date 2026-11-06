/* eslint-disable @typescript-eslint/naming-convention */
import type { Action } from './actions';

/**
 * Groups shown on the personal access token form. Tokens still store the flat
 * scope list; the groups and presets below are derived from it on the client.
 */
export enum AccessTokenScopeGroup {
  Data = 'data',
  Schema = 'schema',
  Automation = 'automation',
  Space = 'space',
  // Always granted with any preset, not shown as a row.
  Basic = 'basic',
  // Only offered to instance / organization admins, never part of a preset.
  Instance = 'instance',
  Enterprise = 'enterprise',
}

/** Groups the token form shows; Basic is always granted and never listed. */
export type IVisibleScopeGroup = Exclude<AccessTokenScopeGroup, AccessTokenScopeGroup.Basic>;

export enum AccessTokenScopeLevel {
  None = 'none',
  Read = 'read',
  Write = 'write',
}

export const ACCESS_TOKEN_SCOPE_PARTIAL = 'partial';

export type IAccessTokenGroupLevel = AccessTokenScopeLevel | typeof ACCESS_TOKEN_SCOPE_PARTIAL;

export const presetScopeGroups = [
  AccessTokenScopeGroup.Data,
  AccessTokenScopeGroup.Schema,
  AccessTokenScopeGroup.Automation,
  AccessTokenScopeGroup.Space,
] as const;

export type IPresetScopeGroup = (typeof presetScopeGroups)[number];

export const adminScopeGroups = [
  AccessTokenScopeGroup.Instance,
  AccessTokenScopeGroup.Enterprise,
] as const;

type IScopeLevel = AccessTokenScopeLevel.Read | AccessTokenScopeLevel.Write;

const { Data, Schema, Automation, Space, Basic, Instance, Enterprise } = AccessTokenScopeGroup;
const R = AccessTokenScopeLevel.Read;
const W = AccessTokenScopeLevel.Write;

// Every action must be classified: adding an action without an entry fails to compile.
export const accessTokenScopeMap: Record<
  Action,
  { group: AccessTokenScopeGroup; level: IScopeLevel }
> = {
  'record|read': { group: Data, level: R },
  'record|copy': { group: Data, level: R },
  'table|export': { group: Data, level: R },
  'base|table_export': { group: Data, level: R },
  'base|query_data': { group: Data, level: R },
  'table_record_history|read': { group: Data, level: R },
  'table|trash_read': { group: Data, level: R },
  'table|archive_read': { group: Data, level: R },
  'record|create': { group: Data, level: W },
  'record|update': { group: Data, level: W },
  'record|delete': { group: Data, level: W },
  'record|comment': { group: Data, level: W },
  'record|archive': { group: Data, level: W },
  'table|import': { group: Data, level: W },
  // Restoring from the trash can also bring back deleted fields and views; accepted for
  // Edit data, which still cannot delete them.
  'table|trash_update': { group: Data, level: W },

  'base|read': { group: Schema, level: R },
  'base|read_all': { group: Schema, level: R },
  'table|read': { group: Schema, level: R },
  'field|read': { group: Schema, level: R },
  'view|read': { group: Schema, level: R },
  'base|create': { group: Schema, level: W },
  'base|update': { group: Schema, level: W },
  'base|delete': { group: Schema, level: W },
  'table|create': { group: Schema, level: W },
  'table|update': { group: Schema, level: W },
  'table|delete': { group: Schema, level: W },
  'field|create': { group: Schema, level: W },
  'field|update': { group: Schema, level: W },
  'field|delete': { group: Schema, level: W },
  'view|create': { group: Schema, level: W },
  'view|update': { group: Schema, level: W },
  'view|delete': { group: Schema, level: W },
  'view|share': { group: Schema, level: W },
  'base|table_import': { group: Schema, level: W },
  'table|trash_reset': { group: Schema, level: W },
  'table|archive_manage': { group: Schema, level: W },

  'automation|read': { group: Automation, level: R },
  'routine|read': { group: Automation, level: R },
  'app|read': { group: Automation, level: R },
  'automation|create': { group: Automation, level: W },
  'automation|update': { group: Automation, level: W },
  'automation|delete': { group: Automation, level: W },
  'routine|create': { group: Automation, level: W },
  'routine|update': { group: Automation, level: W },
  'routine|delete': { group: Automation, level: W },
  'app|create': { group: Automation, level: W },
  'app|update': { group: Automation, level: W },
  'app|delete': { group: Automation, level: W },
  'user|notifications_send': { group: Automation, level: W },
  'user|integrations': { group: Automation, level: W },

  'space|read': { group: Space, level: R },
  'user|spaces_read': { group: Space, level: R },
  'user|self_hosted_licenses_read': { group: Space, level: R },
  'space|create': { group: Space, level: W },
  'space|update': { group: Space, level: W },
  'space|delete': { group: Space, level: W },
  'space|invite_email': { group: Space, level: W },
  'space|invite_link': { group: Space, level: W },
  'space|grant_role': { group: Space, level: W },
  'base|invite_email': { group: Space, level: W },
  'base|invite_link': { group: Space, level: W },
  'base|authority_matrix_config': { group: Space, level: W },

  'user|email_read': { group: Basic, level: R },

  'instance|read': { group: Instance, level: R },
  'instance|update': { group: Instance, level: W },
  'enterprise|read': { group: Enterprise, level: R },
  'enterprise|update': { group: Enterprise, level: W },
};

const scopeEntries = Object.entries(accessTokenScopeMap) as [
  Action,
  { group: AccessTokenScopeGroup; level: IScopeLevel },
][];

export const getAccessTokenGroupActions = (group: AccessTokenScopeGroup) => {
  const read: Action[] = [];
  const write: Action[] = [];
  scopeEntries.forEach(([action, item]) => {
    if (item.group !== group) return;
    (item.level === R ? read : write).push(action);
  });
  return { read, write };
};

export const getAccessTokenGroupLevel = (
  scopes: readonly string[],
  group: AccessTokenScopeGroup
): IAccessTokenGroupLevel => {
  const { read, write } = getAccessTokenGroupActions(group);
  const scopeSet = new Set(scopes);
  const readCount = read.filter((action) => scopeSet.has(action)).length;
  const writeCount = write.filter((action) => scopeSet.has(action)).length;
  if (!readCount && !writeCount) return AccessTokenScopeLevel.None;
  if (readCount === read.length && !writeCount) return AccessTokenScopeLevel.Read;
  if (readCount === read.length && writeCount === write.length) return AccessTokenScopeLevel.Write;
  return ACCESS_TOKEN_SCOPE_PARTIAL;
};

/** Replace every action of a group with the actions of the given level. */
export const setAccessTokenGroupLevel = (
  scopes: readonly string[],
  group: AccessTokenScopeGroup,
  level: AccessTokenScopeLevel
): string[] => {
  const { read, write } = getAccessTokenGroupActions(group);
  const groupActions = new Set<string>([...read, ...write]);
  const next = scopes.filter((scope) => !groupActions.has(scope));
  if (level !== AccessTokenScopeLevel.None) next.push(...read);
  if (level === AccessTokenScopeLevel.Write) next.push(...write);
  return next;
};

export enum AccessTokenPreset {
  ReadOnly = 'readOnly',
  DataEditor = 'dataEditor',
  Builder = 'builder',
  FullAccess = 'fullAccess',
}

export const accessTokenPresetLevels: Record<
  AccessTokenPreset,
  Record<IPresetScopeGroup, AccessTokenScopeLevel>
> = {
  [AccessTokenPreset.ReadOnly]: { data: R, schema: R, automation: R, space: R },
  [AccessTokenPreset.DataEditor]: {
    data: W,
    schema: R,
    automation: R,
    space: R,
  },
  [AccessTokenPreset.Builder]: { data: W, schema: W, automation: W, space: R },
  [AccessTokenPreset.FullAccess]: {
    data: W,
    schema: W,
    automation: W,
    space: W,
  },
};

export const accessTokenPresets = Object.keys(accessTokenPresetLevels) as AccessTokenPreset[];

/**
 * Apply a preset to the preset groups. Scopes outside them (admin scopes) are kept,
 * and the basic scopes are always added.
 */
export const getAccessTokenPresetScopes = (
  preset: AccessTokenPreset,
  currentScopes: readonly string[] = []
): string[] => {
  let scopes = [...currentScopes];
  presetScopeGroups.forEach((group) => {
    scopes = setAccessTokenGroupLevel(scopes, group, accessTokenPresetLevels[preset][group]);
  });
  const basic = getAccessTokenGroupActions(Basic).read;
  return [...scopes.filter((scope) => !basic.includes(scope as Action)), ...basic];
};

/** The preset the scopes match exactly on the preset groups, or null for custom. */
export const getAccessTokenPreset = (scopes: readonly string[]): AccessTokenPreset | null => {
  const levels = presetScopeGroups.map((group) => getAccessTokenGroupLevel(scopes, group));
  return (
    accessTokenPresets.find((preset) =>
      presetScopeGroups.every(
        (group, index) => accessTokenPresetLevels[preset][group] === levels[index]
      )
    ) ?? null
  );
};
