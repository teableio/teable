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

export const pluginBaseActions = [
  'base|read',
  'base|update',
  'base|invite_email',
  'base|invite_link',
  'base|table_import',
  'base|table_export',
  'base|authority_matrix_config',
  'base|db_connection',
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
