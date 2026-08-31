/**
 * Resolves the Google access token of a connected user integration on the
 * server, so refresh tokens never travel through the browser. The community
 * edition has no integration storage; the enterprise backend provides an
 * implementation through this injection token (optional dependency).
 */
export const GOOGLE_SHEET_IMPORT_TOKEN_RESOLVER = 'GOOGLE_SHEET_IMPORT_TOKEN_RESOLVER';

export interface IGoogleSheetImportTokenResolver {
  /**
   * Returns a currently valid access token for the given integration of the
   * requesting user (refreshing it server-side when expired). Must reject
   * when the integration does not exist or belongs to another user.
   */
  resolveAccessToken(integrationId: string): Promise<string>;
}
