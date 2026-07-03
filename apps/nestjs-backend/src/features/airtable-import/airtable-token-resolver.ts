/**
 * Resolves the Airtable access token of a connected user integration on the
 * server, so OAuth tokens never travel through the browser. The community
 * edition has no integration storage; the enterprise backend provides an
 * implementation through this injection token (optional dependency).
 */
export const AIRTABLE_IMPORT_TOKEN_RESOLVER = 'AIRTABLE_IMPORT_TOKEN_RESOLVER';

export interface IAirtableImportTokenResolver {
  /**
   * Returns a currently valid access token for the given integration of the
   * requesting user (refreshing it server-side when expired). Must reject
   * when the integration does not exist or belongs to another user.
   */
  resolveAccessToken(integrationId: string): Promise<string>;
}
