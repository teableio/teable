import type {
  AppAction,
  AutomationAction,
  BaseAction,
  FieldAction,
  RecordAction,
  TableAction,
  UserAction,
  ViewAction,
} from './actions';

export const OAUTH_ACTIONS: (
  | AppAction
  | BaseAction
  | TableAction
  | ViewAction
  | FieldAction
  | RecordAction
  | UserAction
  | AutomationAction
)[] = [
  'app|create',
  'app|delete',
  'app|read',
  'app|update',
  'base|create',
  'base|delete',
  'base|read',
  'base|read_all',
  'base|update',
  'base|table_import',
  'base|table_export',
  'base|query_data',
  'table|create',
  'table|delete',
  'table|export',
  'table|import',
  'table|read',
  'table|update',
  'table|trash_read',
  'table|trash_update',
  'table|trash_reset',
  'view|create',
  'view|delete',
  'view|read',
  'view|update',
  'field|create',
  'field|delete',
  'field|read',
  'field|update',
  'record|comment',
  'record|create',
  'record|delete',
  'record|read',
  'record|update',
  'automation|create',
  'automation|delete',
  'automation|read',
  'automation|update',
  'user|email_read',
  'user|integrations',
];

/**
 * First-party OAuth application for the Teable AI Tools CLI (`@teable/cli`).
 *
 * Every Teable deployment seeds this app on startup (see the backend's
 * OAuthAppInitService) so the CLI's Authorization Code + PKCE login works out of
 * the box — self-hosted and private environments need no manual OAuth app setup.
 *
 * This descriptor is the single source of truth: the CLI reads `clientId` from it,
 * and the backend reconciles the `oauth_app` row against the whole object.
 */
export const cliOAuthApp = {
  clientId: 'clttckxmg4deadomjhs',
  name: 'Teable CLI',
  homepage: 'https://www.npmjs.com/package/@teable/cli',
  description:
    'Official Teable AI Tools CLI — operate bases, tables, fields, views and records from your terminal.',
  /** Storage path of the logo asset shown on the OAuth consent screen. */
  logo: 'logo/email-logo',
  /**
   * Loopback redirect URI. The CLI binds a random localhost port for each login;
   * OAuth PKCE loopback matching ignores the port, so one portless entry is enough.
   */
  redirectUris: ['http://127.0.0.1/callback'],
  scopes: OAUTH_ACTIONS,
};
