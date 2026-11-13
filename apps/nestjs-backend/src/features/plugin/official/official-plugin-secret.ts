import { createHmac } from 'node:crypto';
import { chartConfig } from './config/chart';
import { sheetFormConfig } from './config/sheet-form-view';

/**
 * The secret an official plugin authenticates with when its PLUGIN_*_SECRET is unset: an
 * HMAC of the plugin id under SECRET_KEY, full length, so it still follows SECRET_KEY and
 * needs no configuration of its own. The plugin row stores a bcrypt hash plus a maskedSecret
 * that shows the last 10 characters, so the value must be neither SECRET_KEY itself (that
 * would put part of the root key in the database and the admin plugin page) nor short enough
 * for the hidden part to be brute-forced against the stored hash.
 */
export const deriveOfficialPluginSecret = (secretKey: string, pluginId: string): string =>
  createHmac('sha256', secretKey).update(`teable:official-plugin:${pluginId}`).digest('hex');

/** Each official plugin and the env var that overrides its secret. */
export const OFFICIAL_PLUGIN_SECRETS = [
  { pluginId: chartConfig.id, envKey: 'PLUGIN_CHART_SECRET' },
  { pluginId: sheetFormConfig.id, envKey: 'PLUGIN_SHEETFORMVIEW_SECRET' },
] as const;
