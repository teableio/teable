/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Engine decision for every route that can reach the table core.
 *
 * - v2       a real v2 execution path exists; a legacy alternative may remain.
 * - v2-only  no legacy engine alternative; disabled v2 may fail closed.
 * - host     retained host responsibility, not “no legacy dependencies”.
 * - v1:T8416 the scoped table-core operation lacks a reachable v2 implementation.
 *
 * Decisions are source-backed, not inferred from @UseV2Feature: some v2 paths dispatch manually,
 * and some decorated handlers still execute legacy code. Routes are compared with the installed
 * Express 5 router, so shadowed controller declarations cannot satisfy the ledger.
 */
export type TableRouteDecision = 'v2' | 'v2-only' | 'host' | `v1:${string}`;

export const TABLE_ROUTE_CONTROLLERS: Record<string, true> = {
  AggregationController: true,
  AirtableImportController: true,
  ArchiveController: true,
  BaseController: true,
  BaseNodeController: true,
  BaseNodeFolderController: true,
  BaseShareOpenController: true,
  CommentController: true,
  ExportController: true,
  FieldController: true,
  GoogleSheetImportController: true,
  ImportController: true,
  IntegrityController: true,
  IntegrityV2Controller: true,
  PluginChartController: true,
  PluginContextMenuController: true,
  PluginPanelController: true,
  RecordController: true,
  SelectionController: true,
  ShareController: true,
  TableController: true,
  TemplateController: true,
  TemplateInstallController: true,
  TrashController: true,
  UndoRedoController: true,
  V2Controller: true,
  V2DataQueryController: true,
  V2DataQueryExplainController: true,
  ViewController: true,
};

export const TABLE_ROUTE_PATH_PATTERNS: RegExp[] = [
  /^\/api\/table\/:tableId\//,
  /^\/api\/v2\/(tables|queries|complexity|operations|integrity)(\/|$)/,
  /^\/api\/share\/:shareId\/(view|base)(\/|$)/,
  /^\/api\/trash(\/|$)/,
  /^\/api\/integrity(\/|$)/,
  /^\/api\/import(\/|$)/,
  /^\/api\/export(\/|$)/,
  /^\/api\/base\/(:baseId\/)?(table|import|export|duplicate|create-from-template|publish|node)(\/|$)/,
  /^\/api\/template\/install$/,
  /^\/api\/comment(\/|$)/,
  /^\/api\/plugin\/chart(\/|$)/,
];

/** Routes absent from the community build; EE and CLOUD both register them. */
export const TABLE_ROUTE_EDITIONS: Record<string, 'EE'> = {
  'DELETE /api/table/:tableId/archive/items': 'EE',
  'DELETE /api/table/:tableId/archive/reset': 'EE',
  'GET /api/table/:tableId/archive/items': 'EE',
  'POST /api/table/:tableId/archive/export-stream': 'EE',
  'POST /api/table/:tableId/record/archive': 'EE',
  'POST /api/table/:tableId/record/archive-stream': 'EE',
  'POST /api/table/:tableId/archive/restore': 'EE',
  'POST /api/base/:baseId/sign-attachment-urls': 'EE',
  'POST /api/base/:baseId/sql-query': 'EE',
  'POST /api/template/install': 'EE',
  'GET /api/base/:baseId/template/installs': 'EE',
  'GET /api/base/:baseId/template/installs/:installId': 'EE',
  'POST /api/base/:baseId/template/installs/:installId/report': 'EE',
  'DELETE /api/base/:baseId/template/installs/:installId': 'EE',
};

/** Routes registered only when at least one flag is enabled. */
export const TABLE_ROUTE_FLAGS: Record<string, string[]> = {
  'POST /api/v2/queries/validate': ['V2_DATA_QUERY_ENABLED', 'V2_DATA_QUERY_EXECUTE_ENABLED'],
  'POST /api/v2/queries/execute': ['V2_DATA_QUERY_ENABLED', 'V2_DATA_QUERY_EXECUTE_ENABLED'],
  'POST /api/v2/queries/explain': ['V2_DATA_QUERY_ENABLED', 'V2_DATA_QUERY_EXECUTE_ENABLED'],
};

export const TABLE_ROUTE_LEDGER = {
  // AggregationController
  // Aggregation reads still use v1 except the always-on search routes.
  'GET /api/table/:tableId/aggregation': 'v2',
  'GET /api/table/:tableId/aggregation/calendar-daily-collection': 'v2',
  'GET /api/table/:tableId/aggregation/group-points': 'v2',
  'GET /api/table/:tableId/aggregation/record-index': 'v2',
  'GET /api/table/:tableId/aggregation/row-count': 'v2',
  'GET /api/table/:tableId/aggregation/search-cell-count': 'v2-only',
  'GET /api/table/:tableId/aggregation/search-count': 'v2',
  'GET /api/table/:tableId/aggregation/search-index': 'v2',
  'GET /api/table/:tableId/aggregation/selection': 'v2',
  'GET /api/table/:tableId/aggregation/task-status-collection': 'v2',
  'POST /api/table/:tableId/aggregation/search-matches': 'v2-only',
  // AirtableImportController
  // Airtable: analyze is host; stream is mixed v2 plus legacy view configuration (A23).
  'POST /api/base/import-airtable/analyze': 'host',
  'POST /api/base/import-airtable/stream': 'v2',
  // ArchiveController
  // Record archive writes are v2; archive listing/export/reset still use v1.
  'DELETE /api/table/:tableId/archive/items': 'v1:T8416',
  'DELETE /api/table/:tableId/archive/reset': 'v1:T8416',
  'GET /api/table/:tableId/archive/items': 'v1:T8416',
  'POST /api/table/:tableId/archive/export-stream': 'v1:T8416',
  'POST /api/table/:tableId/archive/restore': 'v2',
  'POST /api/table/:tableId/record/archive': 'v2',
  'POST /api/table/:tableId/record/archive-stream': 'v2',
  // BaseController
  // Base host routes; duplicate/import/export/template routes reach the table engine.
  'DELETE /api/base/:baseId': 'v1:T8416', // A18
  'DELETE /api/base/:baseId/collaborators': 'host',
  'DELETE /api/base/:baseId/invitation/link/:invitationId': 'host',
  'DELETE /api/base/:baseId/permanent': 'v1:T8416', // A18
  'DELETE /api/base/personal-order/:spaceId': 'host',
  'GET /api/base/:baseId': 'host',
  'GET /api/base/:baseId/collaborators': 'host',
  'GET /api/base/:baseId/collaborators/users': 'host',
  'GET /api/base/:baseId/duplicate-check': 'v1:T8416',
  'GET /api/base/:baseId/erd': 'host',
  'GET /api/base/:baseId/export': 'v2',
  'GET /api/base/:baseId/export-stream': 'v2',
  'GET /api/base/:baseId/invitation/link': 'host',
  'GET /api/base/:baseId/move-check': 'host',
  'GET /api/base/:baseId/move-job/:jobId': 'host',
  'GET /api/base/:baseId/permission': 'host',
  'GET /api/base/access/all': 'host',
  'GET /api/base/shared-base': 'host',
  'PATCH /api/base/:baseId': 'host',
  'PATCH /api/base/:baseId/collaborators': 'host',
  'PATCH /api/base/:baseId/invitation/link/:invitationId': 'host',
  'POST /api/base': 'host',
  'POST /api/base/:baseId/collaborator': 'host',
  'POST /api/base/:baseId/invitation/email': 'host',
  'POST /api/base/:baseId/invitation/link': 'host',
  'POST /api/base/:baseId/move-job/:jobId/cancel': 'host',
  'POST /api/base/:baseId/move-job/:jobId/retry': 'host',
  'POST /api/base/:baseId/publish': 'v2-only',
  'POST /api/base/:baseId/sign-attachment-urls': 'host',
  'POST /api/base/:baseId/sql-query': 'host',
  'POST /api/base/create-from-template': 'v2-only',
  'POST /api/base/duplicate': 'v2',
  'POST /api/base/duplicate-stream': 'v2',
  'POST /api/base/import': 'v2',
  'POST /api/base/import-stream': 'v2',
  'PUT /api/base/:baseId/move': 'host',
  'PUT /api/base/:baseId/order': 'host',
  'PUT /api/base/:baseId/personal-order': 'host',
  // BaseNodeController
  // Node reads/folders are host; create/duplicate/delete use v2 dispatch; rename/move still v1 (A16/A22).
  'DELETE /api/base/:baseId/node/:nodeId': 'v2',
  'DELETE /api/base/:baseId/node/:nodeId/permanent': 'v2',
  'GET /api/base/:baseId/node/:nodeId': 'host',
  'GET /api/base/:baseId/node/list': 'host',
  'GET /api/base/:baseId/node/tree': 'host',
  'POST /api/base/:baseId/node': 'v2',
  'POST /api/base/:baseId/node/:nodeId/duplicate': 'v2',
  'POST /api/base/:baseId/node/:nodeId/move-check': 'v1:T8416',
  'PUT /api/base/:baseId/node/:nodeId': 'v1:T8416',
  'PUT /api/base/:baseId/node/:nodeId/move': 'v1:T8416',
  // BaseNodeFolderController
  // Folder organization is host state.
  'DELETE /api/base/:baseId/node/folder/:folderId': 'host',
  'PATCH /api/base/:baseId/node/folder/:folderId': 'host',
  'POST /api/base/:baseId/node/folder': 'host',
  // BaseShareOpenController
  // Shared-base access and copy; copy dispatches to v2 or the legacy duplicator.
  'GET /api/share/:shareId/base': 'host',
  'POST /api/share/:shareId/base/auth': 'host',
  'POST /api/share/:shareId/base/copy': 'v2',
  // CommentController
  // Comments are host state.
  'DELETE /api/comment/:tableId/:recordId/:commentId': 'host',
  'DELETE /api/comment/:tableId/:recordId/:commentId/reaction': 'host',
  'DELETE /api/comment/:tableId/:recordId/subscribe': 'host',
  'GET /api/comment/:tableId/:recordId/:commentId': 'host',
  'GET /api/comment/:tableId/:recordId/attachment/:path': 'host',
  'GET /api/comment/:tableId/:recordId/count': 'host',
  'GET /api/comment/:tableId/:recordId/list': 'host',
  'GET /api/comment/:tableId/:recordId/subscribe': 'host',
  'PATCH /api/comment/:tableId/:recordId/:commentId': 'host',
  'PATCH /api/comment/:tableId/:recordId/:commentId/reaction': 'host',
  'POST /api/comment/:tableId/:recordId/create': 'host',
  'POST /api/comment/:tableId/:recordId/subscribe': 'host',
  'POST /api/comment/:tableId/count': 'host',
  // ExportController
  // CSV export.
  'GET /api/export/:tableId': 'v2',
  // FieldController
  // Field schema engine; plan simulation and delete-references still use v1.
  'DELETE /api/table/:tableId/field': 'v2',
  'DELETE /api/table/:tableId/field/:fieldId': 'v2',
  'DELETE /api/table/:tableId/field/:fieldId/plan': 'v1:T8416',
  'GET /api/table/:tableId/field': 'v2',
  'GET /api/table/:tableId/field/:fieldId': 'v2',
  'GET /api/table/:tableId/field/:fieldId/filter-link-records': 'v2',
  'GET /api/table/:tableId/field/:fieldId/plan': 'v1:T8416',
  'GET /api/table/:tableId/field/delete-references': 'v1:T8416',
  'GET /api/table/:tableId/field/socket/doc-ids': 'v2',
  'GET /api/table/:tableId/field/socket/snapshot-bulk': 'v2',
  'PATCH /api/table/:tableId/field/:fieldId': 'v2',
  'POST /api/table/:tableId/field': 'v2',
  'POST /api/table/:tableId/field/:fieldId/auto-fill': 'host',
  'POST /api/table/:tableId/field/:fieldId/duplicate': 'v2',
  'POST /api/table/:tableId/field/:fieldId/stop-fill': 'host',
  'POST /api/table/:tableId/field/plan': 'v2',
  'PUT /api/table/:tableId/field/:fieldId/convert': 'v2',
  'PUT /api/table/:tableId/field/:fieldId/plan': 'v2',
  // GoogleSheetImportController
  // Google Sheets creates rows/tables through v2 only; picker/analyze are host.
  'GET /api/base/import-google-sheet/picker-config': 'host',
  'POST /api/base/import-google-sheet/analyze': 'host',
  'POST /api/base/import-google-sheet/stream': 'v2-only',
  // ImportController
  // Import pipeline; status/analyze are host reads.
  'GET /api/import/analyze': 'host',
  'GET /api/import/status/:tableId': 'host',
  'PATCH /api/import/:baseId/:tableId': 'v2',
  'PATCH /api/import/:baseId/:tableId/stream': 'v2',
  'POST /api/import/:baseId': 'v2',
  'POST /api/import/:baseId/stream': 'v2',
  // IntegrityController
  // A20 legacy link repair.
  'GET /api/integrity/base/:baseId/link-check': 'v1:T8416',
  'POST /api/integrity/base/:baseId/link-fix': 'v1:T8416',
  // IntegrityV2Controller
  // Native v2 integrity streams; the decision route reports routing state.
  'GET /api/v2/integrity/base/:baseId/check-stream': 'v2-only',
  'GET /api/v2/integrity/base/:baseId/decision': 'host',
  'GET /api/v2/integrity/table/:tableId/check-stream': 'v2-only',
  'POST /api/v2/integrity/base/:baseId/repair-stream': 'v2-only',
  'POST /api/v2/integrity/table/:tableId/repair-stream': 'v2-only',
  // PluginChartController
  // Plugin chart query host.
  'GET /api/plugin/chart/:pluginInstallId/dashboard/:positionId/query': 'host',
  'GET /api/plugin/chart/:pluginInstallId/plugin-panel/:positionId/query': 'host',
  // PluginContextMenuController
  // Plugin UI state (host).
  'DELETE /api/table/:tableId/plugin-context-menu/:pluginInstallId': 'host',
  'GET /api/table/:tableId/plugin-context-menu': 'host',
  'GET /api/table/:tableId/plugin-context-menu/:pluginInstallId': 'host',
  'GET /api/table/:tableId/plugin-context-menu/:pluginInstallId/storage': 'host',
  'PATCH /api/table/:tableId/plugin-context-menu/:pluginInstallId/rename': 'host',
  'POST /api/table/:tableId/plugin-context-menu/install': 'host',
  'PUT /api/table/:tableId/plugin-context-menu/:pluginInstallId/move': 'host',
  'PUT /api/table/:tableId/plugin-context-menu/:pluginInstallId/update-storage': 'host',
  // PluginPanelController
  // Plugin UI state (host).
  'DELETE /api/table/:tableId/plugin-panel/:pluginPanelId': 'host',
  'DELETE /api/table/:tableId/plugin-panel/:pluginPanelId/plugin/:pluginInstallId': 'host',
  'GET /api/table/:tableId/plugin-panel': 'host',
  'GET /api/table/:tableId/plugin-panel/:pluginPanelId': 'host',
  'GET /api/table/:tableId/plugin-panel/:pluginPanelId/plugin/:pluginInstallId': 'host',
  'PATCH /api/table/:tableId/plugin-panel/:pluginPanelId/layout': 'host',
  'PATCH /api/table/:tableId/plugin-panel/:pluginPanelId/plugin/:pluginInstallId/rename': 'host',
  'PATCH /api/table/:tableId/plugin-panel/:pluginPanelId/plugin/:pluginInstallId/update-storage':
    'host',
  'PATCH /api/table/:tableId/plugin-panel/:pluginPanelId/rename': 'host',
  'POST /api/table/:tableId/plugin-panel': 'host',
  'POST /api/table/:tableId/plugin-panel/:pluginPanelId/duplicate': 'host',
  'POST /api/table/:tableId/plugin-panel/:pluginPanelId/install': 'host',
  'POST /api/table/:tableId/plugin-panel/:pluginPanelId/plugin/:pluginInstallId/duplicate': 'host',
  // RecordController
  // Record data engine; history is host, auto-fill is async task orchestration.
  'DELETE /api/table/:tableId/record': 'v2',
  'DELETE /api/table/:tableId/record/:recordId': 'v2',
  'GET /api/table/:tableId/record': 'v2',
  'GET /api/table/:tableId/record/:recordId': 'v2',
  'GET /api/table/:tableId/record/:recordId/history': 'host',
  'GET /api/table/:tableId/record/:recordId/status': 'v2',
  'GET /api/table/:tableId/record/collaborators': 'v2',
  'GET /api/table/:tableId/record/history': 'host',
  'PATCH /api/table/:tableId/record': 'v2',
  'PATCH /api/table/:tableId/record/:recordId': 'v2',
  'POST /api/table/:tableId/record': 'v2',
  'POST /api/table/:tableId/record/:recordId/:fieldId/auto-fill': 'host',
  'POST /api/table/:tableId/record/:recordId/:fieldId/button-click': 'v2',
  'POST /api/table/:tableId/record/:recordId/:fieldId/button-reset': 'v2',
  'POST /api/table/:tableId/record/:recordId/:fieldId/insertAttachment': 'v2',
  'POST /api/table/:tableId/record/:recordId/:fieldId/uploadAttachment': 'v2',
  'POST /api/table/:tableId/record/:recordId/duplicate': 'v2',
  'POST /api/table/:tableId/record/form-submit': 'v2',
  'POST /api/table/:tableId/record/socket/doc-ids': 'v2',
  'POST /api/table/:tableId/record/socket/snapshot-bulk': 'v2',
  'POST /api/table/:tableId/record/upsert': 'v2-only',
  // SelectionController
  // Selection/copy/paste engine; temporary paste still uses v1.
  'DELETE /api/table/:tableId/selection/delete': 'v2',
  'GET /api/table/:tableId/selection/copy': 'v2',
  'GET /api/table/:tableId/selection/delete-stream': 'v2',
  'GET /api/table/:tableId/selection/duplicate-stream': 'v2',
  'GET /api/table/:tableId/selection/range-to-id': 'v2',
  'PATCH /api/table/:tableId/selection/clear': 'v2',
  'PATCH /api/table/:tableId/selection/clear-by-id': 'v2',
  'PATCH /api/table/:tableId/selection/clear-by-id-stream': 'v2',
  'PATCH /api/table/:tableId/selection/clear-stream': 'v2',
  'PATCH /api/table/:tableId/selection/delete-by-id-stream': 'v2',
  'PATCH /api/table/:tableId/selection/paste': 'v2',
  'PATCH /api/table/:tableId/selection/paste-by-id': 'v2',
  'PATCH /api/table/:tableId/selection/paste-by-id-stream': 'v2',
  'PATCH /api/table/:tableId/selection/paste-stream': 'v2',
  'PATCH /api/table/:tableId/selection/temporaryPaste': 'v1:T8416',
  'POST /api/table/:tableId/selection/copy-by-id': 'v2',
  'POST /api/table/:tableId/selection/delete-by-id': 'v2',
  // ShareController
  // Shared-view routes; view access/auth can select v2, sockets are ShareDB host transport.
  'GET /api/share/:shareId/socket/field/doc-ids': 'v2',
  'GET /api/share/:shareId/socket/field/snapshot-bulk': 'v2',
  'GET /api/share/:shareId/socket/view/doc-ids': 'v2',
  'GET /api/share/:shareId/socket/view/snapshot-bulk': 'v2',
  'GET /api/share/:shareId/view': 'v2',
  'GET /api/share/:shareId/view/aggregations': 'v2',
  'GET /api/share/:shareId/view/calendar-daily-collection': 'v2',
  'GET /api/share/:shareId/view/collaborators': 'v2',
  'GET /api/share/:shareId/view/copy': 'v2',
  'GET /api/share/:shareId/view/group-points': 'v2',
  'GET /api/share/:shareId/view/link-records': 'v2',
  'GET /api/share/:shareId/view/records': 'v2',
  'GET /api/share/:shareId/view/row-count': 'v2',
  'GET /api/share/:shareId/view/search-cell-count': 'v2-only',
  'GET /api/share/:shareId/view/search-count': 'v2',
  'GET /api/share/:shareId/view/search-index': 'v2',
  'POST /api/share/:shareId/socket/record/doc-ids': 'v2',
  'POST /api/share/:shareId/socket/record/snapshot-bulk': 'v2',
  'POST /api/share/:shareId/view/auth': 'v2',
  'POST /api/share/:shareId/view/form-submit': 'v2',
  'POST /api/share/:shareId/view/record/:recordId/:fieldId/button-click': 'v2',
  'POST /api/share/:shareId/view/search-matches': 'v2-only',
  // TableController
  // Table structure; index/name/order/permission are host infrastructure.
  'DELETE /api/base/:baseId/table/:tableId': 'v2',
  'DELETE /api/base/:baseId/table/:tableId/permanent': 'v2',
  'GET /api/base/:baseId/table': 'v2',
  'GET /api/base/:baseId/table/:tableId': 'v2',
  'GET /api/base/:baseId/table/:tableId/abnormal-index': 'host',
  'GET /api/base/:baseId/table/:tableId/activated-index': 'host',
  'GET /api/base/:baseId/table/:tableId/default-view-id': 'v2',
  'GET /api/base/:baseId/table/:tableId/delete-references': 'v1:T8416',
  'GET /api/base/:baseId/table/:tableId/duplicate-check': 'v1:T8416',
  'GET /api/base/:baseId/table/:tableId/field/:fieldId/duplicate-check': 'v1:T8416',
  'GET /api/base/:baseId/table/:tableId/index/policy': 'host',
  'GET /api/base/:baseId/table/:tableId/index/query-policy': 'host',
  'GET /api/base/:baseId/table/:tableId/permission': 'host',
  'GET /api/base/:baseId/table/:tableId/search-vector-status': 'host',
  'GET /api/base/:baseId/table/socket/doc-ids': 'v2',
  'GET /api/base/:baseId/table/socket/snapshot-bulk': 'v2',
  'PATCH /api/base/:baseId/table/:tableId/index/repair': 'host',
  'POST /api/base/:baseId/table': 'v2',
  'POST /api/base/:baseId/table/:tableId/duplicate': 'v2',
  'POST /api/base/:baseId/table/:tableId/index': 'host',
  'PUT /api/base/:baseId/table/:tableId/db-table-name': 'v1:T8416',
  'PUT /api/base/:baseId/table/:tableId/description': 'v2',
  'PUT /api/base/:baseId/table/:tableId/icon': 'v2',
  'PUT /api/base/:baseId/table/:tableId/index/policy': 'host',
  'PUT /api/base/:baseId/table/:tableId/index/query-policy': 'host',
  'PUT /api/base/:baseId/table/:tableId/name': 'v2',
  'PUT /api/base/:baseId/table/:tableId/order': 'host',
  // TemplateController
  // Template catalogue and metadata (host); snapshot is v2-only.
  'DELETE /api/template/:templateId': 'host',
  'DELETE /api/template/category/:templateCategoryId': 'host',
  'DELETE /api/template/unpublish/:templateId': 'host',
  'GET /api/template': 'host',
  'GET /api/template/:templateId': 'host',
  'GET /api/template/by-base/:baseId': 'host',
  'GET /api/template/category/list': 'host',
  'GET /api/template/permalink/:identifier': 'host',
  'GET /api/template/published': 'host',
  'PATCH /api/template/:templateId': 'host',
  'PATCH /api/template/:templateId/pin-top': 'host',
  'PATCH /api/template/:templateId/visit': 'host',
  'PATCH /api/template/category/:templateCategoryId': 'host',
  'POST /api/template/:templateId/snapshot': 'v2-only',
  'POST /api/template/category/create': 'host',
  'POST /api/template/create': 'host',
  'PUT /api/template/:templateId/order': 'host',
  'PUT /api/template/category/:templateCategoryId/order': 'host',
  // TemplateInstallController
  // Template install/uninstall now orchestrate native v2 duplication and v2 table deletion.
  'DELETE /api/base/:baseId/template/installs/:installId': 'v2',
  'GET /api/base/:baseId/template/installs': 'host',
  'GET /api/base/:baseId/template/installs/:installId': 'host',
  'POST /api/base/:baseId/template/installs/:installId/report': 'host',
  'POST /api/template/install': 'v2',
  // TrashController
  // Trash reads are host; restore can select v2; purge/reset still v1 (A19).
  'DELETE /api/trash/:trashId': 'v1:T8416',
  'DELETE /api/trash/reset-items': 'v1:T8416',
  'GET /api/trash': 'host',
  'GET /api/trash/:trashId/records': 'host',
  'GET /api/trash/items': 'host',
  'POST /api/trash/restore-field/:trashId/stream': 'v2-only',
  'POST /api/trash/restore/:trashId': 'v2',
  // UndoRedoController
  // Undo/redo canary routes; streams can fall back either way.
  'POST /api/table/:tableId/undo-redo/redo': 'v2',
  'POST /api/table/:tableId/undo-redo/redo-stream': 'v2',
  'POST /api/table/:tableId/undo-redo/undo': 'v2',
  'POST /api/table/:tableId/undo-redo/undo-stream': 'v2',
  // V2Controller
  // Native v2 endpoints.
  'DELETE /api/v2/tables/deleteRecords': 'v2-only',
  'GET /api/v2/operations/preview/capabilities': 'v2-only',
  'GET /api/v2/tables/get': 'v2-only',
  'GET /api/v2/tables/getComputeActivity': 'v2-only',
  'POST /api/v2/complexity/assess': 'v2-only',
  'POST /api/v2/complexity/assess-matrix': 'v2-only',
  'POST /api/v2/operations/preview': 'v2-only',
  'POST /api/v2/tables/create': 'v2-only',
  'POST /api/v2/tables/updateRecords': 'v2-only',
  // V2DataQueryController
  // Native v2 structured query.
  'POST /api/v2/queries/execute': 'v2-only',
  'POST /api/v2/queries/validate': 'v2-only',
  // V2DataQueryExplainController
  // Native v2 structured query.
  'POST /api/v2/queries/explain': 'v2-only',
  // ViewController
  // View configuration engine; plugin routes are host.
  'DELETE /api/table/:tableId/view/:viewId': 'v2',
  'GET /api/table/:tableId/view': 'v2',
  'GET /api/table/:tableId/view/:viewId': 'v2',
  'GET /api/table/:tableId/view/:viewId/filter-link-records': 'v2',
  'GET /api/table/:tableId/view/:viewId/plugin': 'host',
  'GET /api/table/:tableId/view/socket/doc-ids': 'v2',
  'GET /api/table/:tableId/view/socket/snapshot-bulk': 'v2',
  'PATCH /api/table/:tableId/view/:viewId/options': 'v2',
  'PATCH /api/table/:tableId/view/:viewId/plugin/:pluginInstallId': 'host',
  'POST /api/table/:tableId/view': 'v2',
  'POST /api/table/:tableId/view/:viewId/disable-share': 'v2',
  'POST /api/table/:tableId/view/:viewId/duplicate': 'v2',
  'POST /api/table/:tableId/view/:viewId/enable-share': 'v2',
  'POST /api/table/:tableId/view/:viewId/refresh-share-id': 'v2',
  'POST /api/table/:tableId/view/plugin': 'host',
  'PUT /api/table/:tableId/view/:viewId/column-meta': 'v2',
  'PUT /api/table/:tableId/view/:viewId/description': 'v2',
  'PUT /api/table/:tableId/view/:viewId/filter': 'v2',
  'PUT /api/table/:tableId/view/:viewId/group': 'v2',
  'PUT /api/table/:tableId/view/:viewId/locked': 'v2',
  'PUT /api/table/:tableId/view/:viewId/manual-sort': 'v2',
  'PUT /api/table/:tableId/view/:viewId/name': 'v2',
  'PUT /api/table/:tableId/view/:viewId/order': 'v2',
  'PUT /api/table/:tableId/view/:viewId/record-order': 'v2',
  'PUT /api/table/:tableId/view/:viewId/share-meta': 'v2',
  'PUT /api/table/:tableId/view/:viewId/sort': 'v2',
} satisfies Record<string, TableRouteDecision>;
