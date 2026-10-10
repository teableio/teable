import {
  appActions,
  automationActions,
  fieldActions,
  recordActions,
  tableActions,
  tableRecordHistoryActions,
  viewActions,
} from '@teable/core';
import { z } from '../zod';

// Scopes a plugin token may request. Anyone can create a plugin and install it
// into a base they merely edit, so the base-management scopes that hand out
// credentials or seats (db connection, invites, authority matrix) are never
// available to a plugin token, whatever role the plugin user ends up holding.
export const pluginBaseActions = [
  'base|read',
  'base|update',
  'base|table_import',
  'base|table_export',
  'base|query_data',
  ...tableActions,
  ...viewActions,
  ...fieldActions,
  ...recordActions,
  ...tableRecordHistoryActions,
  ...automationActions,
  ...appActions,
] as const;

export const pluginBaseActionSchema = z.enum(pluginBaseActions);
export const pluginBaseScopesSchema = z.array(pluginBaseActionSchema).min(1);

export type PluginBaseAction = z.infer<typeof pluginBaseActionSchema>;
