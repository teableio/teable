import { oc } from '@orpc/contract';
import type { AnyContractRouter } from '@orpc/contract';
import {
  applyViewManualSortInputSchema,
  createBaseInputSchema,
  duplicateBaseByIdInputSchema,
  createFieldInputSchema,
  createRecordInputSchema,
  createRecordsInputSchema,
  submitRecordInputSchema,
  createTableInputSchema,
  createTablesInputSchema,
  createViewInputSchema,
  deleteViewInputSchema,
  disableViewShareInputSchema,
  deleteByRangeCommandInputSchema,
  deleteFieldInputSchema,
  deleteRecordsInputSchema,
  deleteTableInputSchema,
  duplicateFieldInputSchema,
  duplicateRecordInputSchema,
  duplicateTableInputSchema,
  duplicateViewInputSchema,
  enableViewShareInputSchema,
  getRecordByIdInputSchema,
  getTableByIdInputSchema,
  getViewInputSchema,
  getViewFilterLinkRecordsInputSchema,
  getViewPluginInstallInputSchema,
  getViewSnapshotsInputSchema,
  getComputeActivityInputSchema,
  importCsvInputSchema,
  importRecordsInputSchema,
  listBasesInputSchema,
  listTableRecordsInputSchema,
  listTablesInputSchema,
  listViewsInputSchema,
  pasteCommandInputSchema,
  clearCommandInputSchema,
  renameTableInputSchema,
  updateTablePropertiesInputSchema,
  renameViewInputSchema,
  refreshViewShareIdInputSchema,
  restoreTableInputSchema,
  updateFieldInputSchema,
  updateRecordInputSchema,
  updateRecordsInputSchema,
  updateViewColumnMetaInputSchema,
  updateViewDescriptionInputSchema,
  updateViewFilterInputSchema,
  updateViewGroupInputSchema,
  updateViewLockedInputSchema,
  updateViewOptionsInputSchema,
  updateViewOrderInputSchema,
  updateViewPluginStorageInputSchema,
  updateViewShareMetaInputSchema,
  updateViewSortInputSchema,
  reorderRecordsInputSchema,
} from '@teable/v2-core';

import { createBaseOkResponseSchema } from './base/createBase';
import { duplicateBaseOkResponseSchema } from './base/duplicateBase';
import { listBasesOkResponseSchema } from './base/listBases';
import { clearOkResponseSchema } from './table/clear';
import { createFieldOkResponseSchema } from './table/createField';
import { createRecordOkResponseSchema } from './table/createRecord';
import { createRecordsOkResponseSchema } from './table/createRecords';
import { createTableErrorResponseSchema, createTableOkResponseSchema } from './table/createTable';
import { createTablesOkResponseSchema } from './table/createTables';
import { createViewOkResponseSchema } from './table/createView';
import { deleteByRangeOkResponseSchema } from './table/deleteByRange';
import { deleteFieldOkResponseSchema } from './table/deleteField';
import { deleteRecordsOkResponseSchema } from './table/deleteRecords';
import { deleteTableErrorResponseSchema, deleteTableOkResponseSchema } from './table/deleteTable';
import { duplicateFieldOkResponseSchema } from './table/duplicateField';
import { duplicateRecordOkResponseSchema } from './table/duplicateRecord';
import { duplicateTableOkResponseSchema } from './table/duplicateTable';
import {
  explainCreateFieldInputSchema,
  explainCreateRecordInputSchema,
  explainDeleteFieldInputSchema,
  explainDeleteTableInputSchema,
  explainDeleteRecordsInputSchema,
  explainOkResponseSchema,
  explainUpdateFieldInputSchema,
  explainUpdateRecordInputSchema,
} from './table/explainCommand';
import { getComputeActivityOkResponseSchema } from './table/getComputeActivity';
import { getRecordByIdOkResponseSchema } from './table/getRecordById';
import { getTableByIdOkResponseSchema } from './table/getTableById';
import { getViewOkResponseSchema } from './table/getView';
import { importCsvOkResponseSchema } from './table/importCsv';
import { importRecordsOkResponseSchema } from './table/importRecords';
import { listTableRecordsOkResponseSchema } from './table/listTableRecords';
import { listTablesOkResponseSchema } from './table/listTables';
import { listViewsOkResponseSchema } from './table/listViews';
import { pasteOkResponseSchema } from './table/paste';
import { renameTableOkResponseSchema } from './table/renameTable';
import { reorderRecordsOkResponseSchema } from './table/reorderRecords';
import { restoreTableOkResponseSchema } from './table/restoreTable';
import { submitRecordOkResponseSchema } from './table/submitRecord';
import { updateFieldOkResponseSchema } from './table/updateField';
import { updateRecordOkResponseSchema } from './table/updateRecord';
import { updateRecordsOkResponseSchema } from './table/updateRecords';
import { updateTablePropertiesOkResponseSchema } from './table/updateTableProperties';
import {
  applyViewManualSortOkResponseSchema,
  getViewFilterLinkRecordsOkResponseSchema,
  getViewPluginInstallOkResponseSchema,
  getViewSnapshotsOkResponseSchema,
  installViewPluginInputSchema,
  installViewPluginOkResponseSchema,
  listViewDocIdsOkResponseSchema,
  updateViewPluginStorageOkResponseSchema,
  viewMutationOkResponseSchema,
  viewShareMutationOkResponseSchema,
  viewShareStateOkResponseSchema,
} from './table/viewOperations';

const BASES_CREATE_PATH = '/bases/create';
const BASES_DUPLICATE_PATH = '/bases/duplicate';
const BASES_LIST_PATH = '/bases/list';
const TABLES_CREATE_FIELD_PATH = '/tables/createField';
const TABLES_CREATE_PATH = '/tables/create';
const TABLES_CREATE_TABLES_PATH = '/tables/createTables';
const TABLES_CREATE_VIEW_PATH = '/tables/createView';
const TABLES_CREATE_RECORD_PATH = '/tables/createRecord';
const TABLES_SUBMIT_RECORD_PATH = '/tables/submitRecord';
const TABLES_CREATE_RECORDS_PATH = '/tables/createRecords';
const TABLES_DELETE_RECORDS_PATH = '/tables/deleteRecords';
const TABLES_DELETE_FIELD_PATH = '/tables/deleteField';
const TABLES_DELETE_PATH = '/tables/delete';
const TABLES_EXPLAIN_CREATE_FIELD_PATH = '/tables/explainCreateField';
const TABLES_EXPLAIN_CREATE_RECORD_PATH = '/tables/explainCreateRecord';
const TABLES_EXPLAIN_UPDATE_FIELD_PATH = '/tables/explainUpdateField';
const TABLES_EXPLAIN_UPDATE_RECORD_PATH = '/tables/explainUpdateRecord';
const TABLES_EXPLAIN_DELETE_FIELD_PATH = '/tables/explainDeleteField';
const TABLES_EXPLAIN_DELETE_TABLE_PATH = '/tables/explainDeleteTable';
const TABLES_EXPLAIN_DELETE_RECORDS_PATH = '/tables/explainDeleteRecords';
const TABLES_GET_PATH = '/tables/get';
const TABLES_GET_COMPUTE_ACTIVITY_PATH = '/tables/getComputeActivity';
const TABLES_GET_RECORD_PATH = '/tables/getRecord';
const TABLES_GET_VIEW_PATH = '/tables/getView';
const TABLES_IMPORT_CSV_PATH = '/tables/importCsv';
const TABLES_IMPORT_RECORDS_PATH = '/tables/importRecords';
const TABLES_LIST_RECORDS_PATH = '/tables/listRecords';
const TABLES_LIST_PATH = '/tables/list';
const TABLES_LIST_VIEWS_PATH = '/tables/listViews';
const TABLES_PASTE_PATH = '/tables/paste';
const TABLES_CLEAR_PATH = '/tables/clear';
const TABLES_DELETE_BY_RANGE_PATH = '/tables/deleteByRange';
const TABLES_RENAME_PATH = '/tables/rename';
const TABLES_UPDATE_PROPERTIES_PATH = '/tables/updateProperties';
const TABLES_RESTORE_PATH = '/tables/restore';
const TABLES_UPDATE_FIELD_PATH = '/tables/updateField';
const TABLES_UPDATE_RECORD_PATH = '/tables/updateRecord';
const TABLES_UPDATE_RECORDS_PATH = '/tables/updateRecords';
const TABLES_REORDER_RECORDS_PATH = '/tables/reorderRecords';
const TABLES_DUPLICATE_FIELD_PATH = '/tables/duplicateField';
const TABLES_DUPLICATE_RECORD_PATH = '/tables/duplicateRecord';
const TABLES_DUPLICATE_TABLE_PATH = '/tables/duplicateTable';
const TABLES_DELETE_VIEW_PATH = '/tables/deleteView';
const TABLES_DUPLICATE_VIEW_PATH = '/tables/duplicateView';
const TABLES_RENAME_VIEW_PATH = '/tables/renameView';
const TABLES_UPDATE_VIEW_DESCRIPTION_PATH = '/tables/updateViewDescription';
const TABLES_UPDATE_VIEW_LOCKED_PATH = '/tables/updateViewLocked';
const TABLES_UPDATE_VIEW_ORDER_PATH = '/tables/updateViewOrder';
const TABLES_UPDATE_VIEW_COLUMN_META_PATH = '/tables/updateViewColumnMeta';
const TABLES_UPDATE_VIEW_FILTER_PATH = '/tables/updateViewFilter';
const TABLES_UPDATE_VIEW_SORT_PATH = '/tables/updateViewSort';
const TABLES_UPDATE_VIEW_GROUP_PATH = '/tables/updateViewGroup';
const TABLES_UPDATE_VIEW_OPTIONS_PATH = '/tables/updateViewOptions';
const TABLES_APPLY_VIEW_MANUAL_SORT_PATH = '/tables/applyViewManualSort';
const TABLES_UPDATE_VIEW_SHARE_META_PATH = '/tables/updateViewShareMeta';
const TABLES_REFRESH_VIEW_SHARE_ID_PATH = '/tables/refreshViewShareId';
const TABLES_ENABLE_VIEW_SHARE_PATH = '/tables/enableViewShare';
const TABLES_DISABLE_VIEW_SHARE_PATH = '/tables/disableViewShare';
const TABLES_GET_VIEW_FILTER_LINK_RECORDS_PATH = '/tables/getViewFilterLinkRecords';
const TABLES_GET_VIEW_SNAPSHOTS_PATH = '/tables/getViewSnapshots';
const TABLES_LIST_VIEW_DOC_IDS_PATH = '/tables/listViewDocIds';
const TABLES_INSTALL_VIEW_PLUGIN_PATH = '/tables/installViewPlugin';
const TABLES_GET_VIEW_PLUGIN_INSTALL_PATH = '/tables/getViewPluginInstall';
const TABLES_UPDATE_VIEW_PLUGIN_STORAGE_PATH = '/tables/updateViewPluginStorage';

export const v2Contract: AnyContractRouter = {
  bases: {
    create: oc
      .route({
        method: 'POST',
        path: BASES_CREATE_PATH,
        successStatus: 201,
        summary: 'Create base',
        tags: ['bases'],
      })
      .input(createBaseInputSchema)
      .output(createBaseOkResponseSchema),
    duplicate: oc
      .route({
        method: 'POST',
        path: BASES_DUPLICATE_PATH,
        successStatus: 201,
        summary: 'Duplicate base',
        tags: ['bases'],
      })
      .input(duplicateBaseByIdInputSchema)
      .output(duplicateBaseOkResponseSchema),
    list: oc
      .route({
        method: 'GET',
        path: BASES_LIST_PATH,
        successStatus: 200,
        summary: 'List bases',
        tags: ['bases'],
      })
      .input(listBasesInputSchema)
      .output(listBasesOkResponseSchema),
  },
  tables: {
    create: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_PATH,
        successStatus: 201,
        summary: 'Create table',
        tags: ['tables'],
      })
      .input(createTableInputSchema)
      .output(createTableOkResponseSchema),
    createTables: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_TABLES_PATH,
        successStatus: 201,
        summary: 'Create tables',
        tags: ['tables'],
      })
      .input(createTablesInputSchema)
      .output(createTablesOkResponseSchema),
    createField: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_FIELD_PATH,
        successStatus: 200,
        summary: 'Create field',
        tags: ['tables'],
      })
      .input(createFieldInputSchema)
      .output(createFieldOkResponseSchema),
    createView: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_VIEW_PATH,
        successStatus: 200,
        summary: 'Create view',
        tags: ['tables'],
      })
      .input(createViewInputSchema)
      .output(createViewOkResponseSchema),
    explainCreateField: oc
      .route({
        method: 'POST',
        path: TABLES_EXPLAIN_CREATE_FIELD_PATH,
        successStatus: 200,
        summary: 'Explain create field',
        tags: ['tables'],
      })
      .input(explainCreateFieldInputSchema)
      .output(explainOkResponseSchema),
    updateField: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_FIELD_PATH,
        successStatus: 200,
        summary: 'Update field',
        tags: ['tables'],
      })
      .input(updateFieldInputSchema)
      .output(updateFieldOkResponseSchema),
    explainUpdateField: oc
      .route({
        method: 'POST',
        path: TABLES_EXPLAIN_UPDATE_FIELD_PATH,
        successStatus: 200,
        summary: 'Explain update field',
        tags: ['tables'],
      })
      .input(explainUpdateFieldInputSchema)
      .output(explainOkResponseSchema),
    updateRecords: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_RECORDS_PATH,
        successStatus: 200,
        summary: 'Update multiple records by filter or recordIds',
        tags: ['tables'],
      })
      .input(updateRecordsInputSchema)
      .output(updateRecordsOkResponseSchema),
    createRecord: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_RECORD_PATH,
        successStatus: 201,
        summary: 'Create record',
        tags: ['tables'],
      })
      .input(createRecordInputSchema)
      .output(createRecordOkResponseSchema),
    submitRecord: oc
      .route({
        method: 'POST',
        path: TABLES_SUBMIT_RECORD_PATH,
        successStatus: 201,
        summary: 'Submit record from form',
        tags: ['tables'],
      })
      .input(submitRecordInputSchema)
      .output(submitRecordOkResponseSchema),
    createRecords: oc
      .route({
        method: 'POST',
        path: TABLES_CREATE_RECORDS_PATH,
        successStatus: 201,
        summary: 'Create multiple records',
        tags: ['tables'],
      })
      .input(createRecordsInputSchema)
      .output(createRecordsOkResponseSchema),
    deleteRecords: oc
      .route({
        method: 'DELETE',
        path: TABLES_DELETE_RECORDS_PATH,
        successStatus: 200,
        summary: 'Delete records',
        tags: ['tables'],
      })
      .input(deleteRecordsInputSchema)
      .output(deleteRecordsOkResponseSchema),
    deleteField: oc
      .route({
        method: 'DELETE',
        path: TABLES_DELETE_FIELD_PATH,
        successStatus: 200,
        summary: 'Delete field',
        tags: ['tables'],
      })
      .input(deleteFieldInputSchema)
      .output(deleteFieldOkResponseSchema),
    explainDeleteField: oc
      .route({
        method: 'POST',
        path: TABLES_EXPLAIN_DELETE_FIELD_PATH,
        successStatus: 200,
        summary: 'Explain delete field',
        tags: ['tables'],
      })
      .input(explainDeleteFieldInputSchema)
      .output(explainOkResponseSchema),
    explainDeleteTable: oc
      .route({
        method: 'POST',
        path: TABLES_EXPLAIN_DELETE_TABLE_PATH,
        successStatus: 200,
        summary: 'Explain delete table',
        tags: ['tables'],
      })
      .input(explainDeleteTableInputSchema)
      .output(explainOkResponseSchema),
    delete: oc
      .route({
        method: 'DELETE',
        path: TABLES_DELETE_PATH,
        successStatus: 200,
        summary: 'Delete table',
        tags: ['tables'],
      })
      .input(deleteTableInputSchema)
      .output(deleteTableOkResponseSchema),
    restore: oc
      .route({
        method: 'POST',
        path: TABLES_RESTORE_PATH,
        successStatus: 200,
        summary: 'Restore table',
        tags: ['tables'],
      })
      .input(restoreTableInputSchema)
      .output(restoreTableOkResponseSchema),
    getById: oc
      .route({
        method: 'GET',
        path: TABLES_GET_PATH,
        successStatus: 200,
        summary: 'Get table by id',
        tags: ['tables'],
      })
      .input(getTableByIdInputSchema)
      .output(getTableByIdOkResponseSchema),
    getComputeActivity: oc
      .route({
        method: 'GET',
        path: TABLES_GET_COMPUTE_ACTIVITY_PATH,
        successStatus: 200,
        summary: 'Get table compute activity and performance diagnostics',
        tags: ['tables'],
      })
      .input(getComputeActivityInputSchema)
      .output(getComputeActivityOkResponseSchema),
    getRecord: oc
      .route({
        method: 'GET',
        path: TABLES_GET_RECORD_PATH,
        successStatus: 200,
        summary: 'Get record by id',
        tags: ['tables'],
      })
      .input(getRecordByIdInputSchema)
      .output(getRecordByIdOkResponseSchema),
    getView: oc
      .route({
        method: 'GET',
        path: TABLES_GET_VIEW_PATH,
        successStatus: 200,
        summary: 'Get view',
        tags: ['tables'],
      })
      .input(getViewInputSchema)
      .output(getViewOkResponseSchema),
    importCsv: oc
      .route({
        method: 'POST',
        path: TABLES_IMPORT_CSV_PATH,
        successStatus: 201,
        summary: 'Import CSV to create table with records',
        tags: ['tables'],
      })
      .input(importCsvInputSchema)
      .output(importCsvOkResponseSchema),
    importRecords: oc
      .route({
        method: 'POST',
        path: TABLES_IMPORT_RECORDS_PATH,
        successStatus: 200,
        summary: 'Import records into existing table',
        tags: ['tables'],
      })
      .input(importRecordsInputSchema)
      .output(importRecordsOkResponseSchema),
    listRecords: oc
      .route({
        method: 'GET',
        path: TABLES_LIST_RECORDS_PATH,
        successStatus: 200,
        summary: 'List table records',
        tags: ['tables'],
      })
      .input(listTableRecordsInputSchema)
      .output(listTableRecordsOkResponseSchema),
    list: oc
      .route({
        method: 'GET',
        path: TABLES_LIST_PATH,
        successStatus: 200,
        summary: 'List tables',
        tags: ['tables'],
      })
      .input(listTablesInputSchema)
      .output(listTablesOkResponseSchema),
    listViews: oc
      .route({
        method: 'GET',
        path: TABLES_LIST_VIEWS_PATH,
        successStatus: 200,
        summary: 'List views',
        tags: ['tables'],
      })
      .input(listViewsInputSchema)
      .output(listViewsOkResponseSchema),
    rename: oc
      .route({
        method: 'POST',
        path: TABLES_RENAME_PATH,
        successStatus: 200,
        summary: 'Rename table',
        tags: ['tables'],
      })
      .input(renameTableInputSchema)
      .output(renameTableOkResponseSchema),
    updateProperties: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_PROPERTIES_PATH,
        successStatus: 200,
        summary: 'Update table properties',
        tags: ['tables'],
      })
      .input(updateTablePropertiesInputSchema)
      .output(updateTablePropertiesOkResponseSchema),
    updateRecord: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_RECORD_PATH,
        successStatus: 200,
        summary: 'Update record',
        tags: ['tables'],
      })
      .input(updateRecordInputSchema)
      .output(updateRecordOkResponseSchema),
    reorderRecords: oc
      .route({
        method: 'POST',
        path: TABLES_REORDER_RECORDS_PATH,
        successStatus: 200,
        summary: 'Reorder records',
        tags: ['tables'],
      })
      .input(reorderRecordsInputSchema)
      .output(reorderRecordsOkResponseSchema),
    duplicateField: oc
      .route({
        method: 'POST',
        path: TABLES_DUPLICATE_FIELD_PATH,
        successStatus: 200,
        summary: 'Duplicate field',
        tags: ['tables'],
      })
      .input(duplicateFieldInputSchema)
      .output(duplicateFieldOkResponseSchema),
    duplicateRecord: oc
      .route({
        method: 'POST',
        path: TABLES_DUPLICATE_RECORD_PATH,
        successStatus: 201,
        summary: 'Duplicate record',
        tags: ['tables'],
      })
      .input(duplicateRecordInputSchema)
      .output(duplicateRecordOkResponseSchema),
    duplicateTable: oc
      .route({
        method: 'POST',
        path: TABLES_DUPLICATE_TABLE_PATH,
        successStatus: 201,
        summary: 'Duplicate table',
        tags: ['tables'],
      })
      .input(duplicateTableInputSchema)
      .output(duplicateTableOkResponseSchema),
    paste: oc
      .route({
        method: 'POST',
        path: TABLES_PASTE_PATH,
        successStatus: 200,
        summary: 'Paste content to table cells',
        tags: ['tables'],
      })
      .input(pasteCommandInputSchema)
      .output(pasteOkResponseSchema),
    clear: oc
      .route({
        method: 'POST',
        path: TABLES_CLEAR_PATH,
        successStatus: 200,
        summary: 'Clear cell values in selected range',
        tags: ['tables'],
      })
      .input(clearCommandInputSchema)
      .output(clearOkResponseSchema),
    deleteByRange: oc
      .route({
        method: 'DELETE',
        path: TABLES_DELETE_BY_RANGE_PATH,
        successStatus: 200,
        summary: 'Delete records by range selection',
        tags: ['tables'],
      })
      .input(deleteByRangeCommandInputSchema)
      .output(deleteByRangeOkResponseSchema),
    deleteView: oc
      .route({
        method: 'POST',
        path: TABLES_DELETE_VIEW_PATH,
        successStatus: 200,
        summary: 'Delete view',
        tags: ['tables'],
      })
      .input(deleteViewInputSchema)
      .output(viewMutationOkResponseSchema),
    duplicateView: oc
      .route({
        method: 'POST',
        path: TABLES_DUPLICATE_VIEW_PATH,
        successStatus: 200,
        summary: 'Duplicate view',
        tags: ['tables'],
      })
      .input(duplicateViewInputSchema)
      .output(viewMutationOkResponseSchema),
    renameView: oc
      .route({
        method: 'POST',
        path: TABLES_RENAME_VIEW_PATH,
        successStatus: 200,
        summary: 'Rename view',
        tags: ['tables'],
      })
      .input(renameViewInputSchema)
      .output(viewMutationOkResponseSchema),
    updateViewDescription: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_VIEW_DESCRIPTION_PATH,
        successStatus: 200,
        summary: 'Update view description',
        tags: ['tables'],
      })
      .input(updateViewDescriptionInputSchema)
      .output(viewMutationOkResponseSchema),
    updateViewLocked: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_VIEW_LOCKED_PATH,
        successStatus: 200,
        summary: 'Update view lock state',
        tags: ['tables'],
      })
      .input(updateViewLockedInputSchema)
      .output(viewMutationOkResponseSchema),
    updateViewOrder: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_VIEW_ORDER_PATH,
        successStatus: 200,
        summary: 'Update view order',
        tags: ['tables'],
      })
      .input(updateViewOrderInputSchema)
      .output(viewMutationOkResponseSchema),
    updateViewColumnMeta: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_VIEW_COLUMN_META_PATH,
        successStatus: 200,
        summary: 'Update view column metadata',
        tags: ['tables'],
      })
      .input(updateViewColumnMetaInputSchema)
      .output(viewMutationOkResponseSchema),
    updateViewFilter: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_VIEW_FILTER_PATH,
        successStatus: 200,
        summary: 'Update view filter',
        tags: ['tables'],
      })
      .input(updateViewFilterInputSchema)
      .output(viewMutationOkResponseSchema),
    updateViewSort: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_VIEW_SORT_PATH,
        successStatus: 200,
        summary: 'Update view sort',
        tags: ['tables'],
      })
      .input(updateViewSortInputSchema)
      .output(viewMutationOkResponseSchema),
    updateViewGroup: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_VIEW_GROUP_PATH,
        successStatus: 200,
        summary: 'Update view group',
        tags: ['tables'],
      })
      .input(updateViewGroupInputSchema)
      .output(viewMutationOkResponseSchema),
    updateViewOptions: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_VIEW_OPTIONS_PATH,
        successStatus: 200,
        summary: 'Update view options',
        tags: ['tables'],
      })
      .input(updateViewOptionsInputSchema)
      .output(viewMutationOkResponseSchema),
    applyViewManualSort: oc
      .route({
        method: 'POST',
        path: TABLES_APPLY_VIEW_MANUAL_SORT_PATH,
        successStatus: 200,
        summary: 'Apply view manual sort',
        tags: ['tables'],
      })
      .input(applyViewManualSortInputSchema)
      .output(applyViewManualSortOkResponseSchema),
    updateViewShareMeta: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_VIEW_SHARE_META_PATH,
        successStatus: 200,
        summary: 'Update view share metadata',
        tags: ['tables'],
      })
      .input(updateViewShareMetaInputSchema)
      .output(viewShareStateOkResponseSchema),
    refreshViewShareId: oc
      .route({
        method: 'POST',
        path: TABLES_REFRESH_VIEW_SHARE_ID_PATH,
        successStatus: 200,
        summary: 'Refresh view share ID',
        tags: ['tables'],
      })
      .input(refreshViewShareIdInputSchema)
      .output(viewShareMutationOkResponseSchema),
    enableViewShare: oc
      .route({
        method: 'POST',
        path: TABLES_ENABLE_VIEW_SHARE_PATH,
        successStatus: 200,
        summary: 'Enable view sharing',
        tags: ['tables'],
      })
      .input(enableViewShareInputSchema)
      .output(viewShareMutationOkResponseSchema),
    disableViewShare: oc
      .route({
        method: 'POST',
        path: TABLES_DISABLE_VIEW_SHARE_PATH,
        successStatus: 200,
        summary: 'Disable view sharing',
        tags: ['tables'],
      })
      .input(disableViewShareInputSchema)
      .output(viewShareStateOkResponseSchema),
    getViewFilterLinkRecords: oc
      .route({
        method: 'GET',
        path: TABLES_GET_VIEW_FILTER_LINK_RECORDS_PATH,
        successStatus: 200,
        summary: 'Get records referenced by view filters',
        tags: ['tables'],
      })
      .input(getViewFilterLinkRecordsInputSchema)
      .output(getViewFilterLinkRecordsOkResponseSchema),
    getViewSnapshots: oc
      .route({
        method: 'GET',
        path: TABLES_GET_VIEW_SNAPSHOTS_PATH,
        successStatus: 200,
        summary: 'Get view snapshots',
        tags: ['tables'],
      })
      .input(getViewSnapshotsInputSchema)
      .output(getViewSnapshotsOkResponseSchema),
    listViewDocIds: oc
      .route({
        method: 'GET',
        path: TABLES_LIST_VIEW_DOC_IDS_PATH,
        successStatus: 200,
        summary: 'List view document IDs',
        tags: ['tables'],
      })
      .input(listViewsInputSchema)
      .output(listViewDocIdsOkResponseSchema),
    installViewPlugin: oc
      .route({
        method: 'POST',
        path: TABLES_INSTALL_VIEW_PLUGIN_PATH,
        successStatus: 200,
        summary: 'Install a plugin view',
        tags: ['tables'],
      })
      .input(installViewPluginInputSchema)
      .output(installViewPluginOkResponseSchema),
    getViewPluginInstall: oc
      .route({
        method: 'GET',
        path: TABLES_GET_VIEW_PLUGIN_INSTALL_PATH,
        successStatus: 200,
        summary: 'Get plugin view installation metadata',
        tags: ['tables'],
      })
      .input(getViewPluginInstallInputSchema)
      .output(getViewPluginInstallOkResponseSchema),
    updateViewPluginStorage: oc
      .route({
        method: 'POST',
        path: TABLES_UPDATE_VIEW_PLUGIN_STORAGE_PATH,
        successStatus: 200,
        summary: 'Update plugin view storage',
        tags: ['tables'],
      })
      .input(updateViewPluginStorageInputSchema)
      .output(updateViewPluginStorageOkResponseSchema),
    explainCreateRecord: oc
      .route({
        method: 'POST',
        path: TABLES_EXPLAIN_CREATE_RECORD_PATH,
        successStatus: 200,
        summary: 'Explain create record command',
        tags: ['tables', 'explain'],
      })
      .input(explainCreateRecordInputSchema)
      .output(explainOkResponseSchema),
    explainUpdateRecord: oc
      .route({
        method: 'POST',
        path: TABLES_EXPLAIN_UPDATE_RECORD_PATH,
        successStatus: 200,
        summary: 'Explain update record command',
        tags: ['tables', 'explain'],
      })
      .input(explainUpdateRecordInputSchema)
      .output(explainOkResponseSchema),
    explainDeleteRecords: oc
      .route({
        method: 'POST',
        path: TABLES_EXPLAIN_DELETE_RECORDS_PATH,
        successStatus: 200,
        summary: 'Explain delete records command',
        tags: ['tables', 'explain'],
      })
      .input(explainDeleteRecordsInputSchema)
      .output(explainOkResponseSchema),
  },
} as const satisfies AnyContractRouter;

export const v2ContractErrors = {
  400: createTableErrorResponseSchema,
  404: deleteTableErrorResponseSchema,
  500: createTableErrorResponseSchema,
} as const;
