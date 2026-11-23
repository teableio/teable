import type { V2MemberContract } from './contract';

export type ProcedurePath = {
  [Group in keyof V2MemberContract]: `${Group & string}.${keyof V2MemberContract[Group] & string}`;
}[keyof V2MemberContract];

export type ProcedureAction =
  | 'base|create'
  | 'base|read'
  | 'base|read_all'
  | 'base|update'
  | 'base|table_import'
  | 'table|create'
  | 'table|read'
  | 'table|update'
  | 'table|delete'
  | 'table|import'
  | 'table|trash_update'
  | 'field|create'
  | 'field|read'
  | 'field|update'
  | 'field|delete'
  | 'view|create'
  | 'view|read'
  | 'view|update'
  | 'view|delete'
  | 'view|share'
  | 'record|create'
  | 'record|read'
  | 'record|update'
  | 'record|delete'
  | 'record|copy';

export type ProcedureAuditAction =
  | 'base.create'
  | 'base.duplicate'
  | 'table.create'
  | 'table.update'
  | 'table.delete'
  | 'table.permanent-delete'
  | 'table.restore'
  | 'table.field.create'
  | 'table.field.update'
  | 'table.field.delete'
  | 'table.record.create'
  | 'table.record.update'
  | 'table.record.delete'
  | 'table.view.create'
  | 'table.view.update'
  | 'table.view.delete'
  | 'shared.view.create'
  | 'shared.view.update'
  | 'shared.view.delete'
  | 'shared.view.refresh'
  | 'table.import'
  | 'table.inplace-import'
  | 'table.duplicate'
  | 'form.record.submit'
  | 'table.record.paste.create';

export type ProcedureAuditDecision =
  | {
      readonly rootAction:
        | ProcedureAuditAction
        | ((input: Record<string, unknown>) => ProcedureAuditAction);
    }
  | { readonly source: 'native-events' };

export interface ProcedurePolicy {
  readonly actions: readonly ProcedureAction[];
  readonly resource: 'table' | 'base' | 'space' | 'optionalTable' | 'preview' | 'authenticated';
  readonly write: boolean;
  readonly audit?: ProcedureAuditDecision;
  readonly growth: 'none' | 'create' | 'duplicate' | 'import' | 'paste' | 'restore' | 'upsert';
  readonly diagnostics?: boolean;
  readonly includeInactive?: boolean;
}

const read = (
  actions: readonly ProcedureAction[],
  resource: ProcedurePolicy['resource'] = 'table',
  diagnostics = false
): ProcedurePolicy => ({ actions, resource, write: false, growth: 'none', diagnostics });
const write = (
  action: ProcedureAction,
  audit: ProcedureAuditDecision,
  resource: ProcedurePolicy['resource'] = 'table',
  growth: ProcedurePolicy['growth'] = 'none',
  extra: readonly ProcedureAction[] = []
): ProcedurePolicy => ({ actions: [action, ...extra], resource, write: true, audit, growth });

/** Adding a member procedure requires an explicit host admission, audit and growth decision. */
export const procedurePolicy = {
  'bases.create': write('base|create', { rootAction: 'base.create' }, 'space'),
  'bases.duplicate': write('base|create', { rootAction: 'base.duplicate' }, 'space', 'duplicate', [
    'base|read',
  ]),
  'bases.list': read(['base|read_all'], 'authenticated'),
  'tables.create': write('table|create', { rootAction: 'table.create' }, 'base', 'create'),
  'tables.createTables': write('table|create', { rootAction: 'table.create' }, 'base', 'create'),
  'tables.createField': write('field|create', { rootAction: 'table.field.create' }),
  'tables.createView': write('view|create', { rootAction: 'table.view.create' }),
  'tables.explainCreateField': read(['field|create'], 'table', true),
  'tables.updateField': write('field|update', { rootAction: 'table.field.update' }),
  'tables.explainUpdateField': read(['field|update'], 'table', true),
  'tables.updateRecords': write('record|update', { rootAction: 'table.record.update' }),
  // Upsert has no existing umbrella action: preserve each real create/update event's action.
  'tables.upsertRecords': write('record|update', { source: 'native-events' }, 'table', 'upsert', [
    'record|create',
  ]),
  'tables.createRecord': write(
    'record|create',
    { rootAction: 'table.record.create' },
    'table',
    'create'
  ),
  'tables.submitRecord': write(
    'record|create',
    { rootAction: 'form.record.submit' },
    'table',
    'create'
  ),
  'tables.createRecords': write(
    'record|create',
    { rootAction: 'table.record.create' },
    'table',
    'create'
  ),
  'tables.deleteRecords': write('record|delete', { rootAction: 'table.record.delete' }),
  'tables.deleteField': write('field|delete', { rootAction: 'table.field.delete' }),
  'tables.explainDeleteField': read(['field|delete'], 'table', true),
  'tables.explainDeleteTable': read(['table|delete'], 'table', true),
  'tables.delete': {
    ...write('table|delete', {
      rootAction: (input) =>
        input.mode === 'permanent' ? 'table.permanent-delete' : 'table.delete',
    }),
    includeInactive: true,
  },
  'tables.restore': {
    ...write('table|trash_update', { rootAction: 'table.restore' }, 'table', 'restore'),
    includeInactive: true,
  },
  'tables.getById': read(['table|read']),
  'tables.getComputeActivity': read(['table|read'], 'table', true),
  'tables.getSchema': read(['table|read', 'field|read']),
  'tables.listFields': read(['field|read']),
  'tables.getRecord': read(['record|read']),
  'tables.getView': read(['view|read']),
  'tables.importCsv': write('table|import', { rootAction: 'table.import' }, 'base', 'import'),
  'tables.importRecords': write(
    'record|create',
    { rootAction: 'table.inplace-import' },
    'table',
    'import'
  ),
  'tables.listRecords': read(['record|read']),
  'tables.list': read(['table|read'], 'base'),
  'tables.listViews': read(['view|read']),
  'tables.rename': write('table|update', { rootAction: 'table.update' }),
  'tables.updateProperties': write('table|update', { rootAction: 'table.update' }),
  'tables.updateRecord': write('record|update', { rootAction: 'table.record.update' }),
  'tables.reorderRecords': write('record|update', { rootAction: 'table.record.update' }),
  'tables.duplicateField': write('field|create', { rootAction: 'table.field.create' }),
  'tables.duplicateRecord': write(
    'record|create',
    { rootAction: 'table.record.create' },
    'table',
    'duplicate',
    ['record|read']
  ),
  'tables.duplicateTable': write(
    'table|create',
    { rootAction: 'table.duplicate' },
    'table',
    'duplicate',
    ['table|read']
  ),
  // Paste create/update projections retain their existing event-source normalization.
  'tables.paste': write(
    'record|update',
    { rootAction: 'table.record.paste.create' },
    'table',
    'paste'
  ),
  'tables.clear': write('record|update', { rootAction: 'table.record.update' }),
  'tables.deleteByRange': write('record|delete', { rootAction: 'table.record.delete' }),
  'tables.deleteView': write('view|delete', { rootAction: 'table.view.delete' }),
  'tables.duplicateView': write(
    'view|create',
    { rootAction: 'table.view.create' },
    'table',
    'none',
    ['view|read']
  ),
  'tables.renameView': write('view|update', { rootAction: 'table.view.update' }),
  'tables.updateViewDescription': write('view|update', { rootAction: 'table.view.update' }),
  'tables.updateViewLocked': write('view|update', { rootAction: 'table.view.update' }),
  'tables.updateViewOrder': write('view|update', { rootAction: 'table.view.update' }),
  'tables.updateViewColumnMeta': write('view|update', { rootAction: 'table.view.update' }),
  'tables.updateViewFilter': write('view|update', { rootAction: 'table.view.update' }),
  'tables.updateViewSort': write('view|update', { rootAction: 'table.view.update' }),
  'tables.updateViewGroup': write('view|update', { rootAction: 'table.view.update' }),
  'tables.updateViewOptions': write('view|update', { rootAction: 'table.view.update' }),
  'tables.applyViewManualSort': write('view|update', { rootAction: 'table.view.update' }),
  'tables.applyViewSnapshot': write('view|update', { rootAction: 'table.view.update' }),
  'tables.updateViewShareMeta': write('view|share', { rootAction: 'shared.view.update' }),
  'tables.refreshViewShareId': write('view|share', { rootAction: 'shared.view.refresh' }),
  'tables.enableViewShare': write('view|share', { rootAction: 'shared.view.create' }),
  'tables.disableViewShare': write('view|share', { rootAction: 'shared.view.delete' }),
  'tables.getViewFilterLinkRecords': read(['view|read', 'record|read']),
  'tables.getViewSnapshots': read(['view|read']),
  'tables.listViewDocIds': read(['view|read']),
  'tables.installViewPlugin': write('view|update', { rootAction: 'table.view.update' }),
  'tables.getViewPluginInstall': read(['view|read']),
  'tables.updateViewPluginStorage': write('view|update', { rootAction: 'table.view.update' }),
  'tables.explainCreateRecord': read(['record|create'], 'table', true),
  'tables.explainUpdateRecord': read(['record|update'], 'table', true),
  'tables.explainDeleteRecords': read(['record|delete'], 'table', true),
  'operations.preview': read([], 'preview', true),
  'operations.capabilities': read([], 'authenticated'),
  'complexity.assess': read(['table|read'], 'optionalTable', true),
  'complexity.assessMatrix': read(['table|read'], 'table', true),
  'workflows.aggregateRecords': read(['record|read']),
  'workflows.countRecords': read(['record|read']),
  'workflows.importTableFromFile': write(
    'base|table_import',
    { rootAction: 'table.import' },
    'base',
    'import'
  ),
  'workflows.inplaceImportTableFromFile': write(
    'table|import',
    { rootAction: 'table.inplace-import' },
    'table',
    'import'
  ),
  'workflows.getImportStatus': read(['table|import']),
} satisfies Record<ProcedurePath, ProcedurePolicy>;
