import type { Action } from '@teable/core';
import { domainError, registerFieldOperationPlugin, registerRecordQueryPlugin, registerRecordWritePlugin, registerTableOperationPlugin, registerViewOperationPlugin, type DomainError, type RecordWriteOperationKind } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';
import type { PermissionService } from '../auth/permission.service';
import { resolveViewOperationPermissionActions } from './v2-public-view-policy';

/** The public transport adds token/resource ceilings to every nested native operation. */
export const registerPublicPermissionPlugins = (
  container: DependencyContainer,
  permissions: PermissionService,
  state: () => { active: boolean; tokenId?: string; actorId?: string; compensation?: { baseId: string; tableIds: readonly string[] } }
): void => {
  const admit = async (id: string, actions: Action[], includeInactive = false): Promise<Result<void, DomainError>> => {
    const request = state();
    if (!request.active) return ok(undefined);
    try {
      await permissions.validPermissions(id, actions, request.tokenId, includeInactive);
      return ok(undefined);
    } catch {
      return err(domainError.forbidden({ code: 'public.authorization.forbidden', message: 'You do not have permission to perform this operation.' }));
    }
  };
  registerTableOperationPlugin(container, {
    name: 'public-member-resource-ceiling', enforce: 'pre', supports: () => true,
    guard: async (context) => {
      const payload = context.payload;
      switch (context.kind) {
        case 'read': return admit(context.payload.table.id().toString(), ['table|read']);
        case 'rename': case 'updateProperties': return admit(context.payload.table.id().toString(), ['table|update']);
        case 'delete': {
          const compensation = state().compensation;
          if (state().active && context.payload.mode === 'permanent' && state().actorId === context.executionContext.actorId.toString() && compensation?.baseId === context.payload.table.baseId().toString() && compensation.tableIds.includes(context.payload.table.id().toString())) return ok(undefined);
          return admit(context.payload.table.id().toString(), ['table|delete'], context.payload.mode === 'permanent');
        }
        case 'restore': return admit(context.payload.table.id().toString(), ['table|trash_update'], true);
        case 'duplicate': {
          const source = await admit(context.payload.sourceTable.id().toString(), ['table|read']);
          if (source.isErr()) return source;
          return admit(payload.baseId.toString(), ['table|create']);
        }
        case 'importCsv': return admit(payload.baseId.toString(), ['table|import', 'table|create']);
        case 'create': case 'createMany': return admit(payload.baseId.toString(), ['table|create']);
      }
    },
  });
  registerFieldOperationPlugin(container, {
    name: 'public-member-resource-ceiling', enforce: 'pre', supports: () => true,
    guard: async (context) => {
      const actions: Action[] = [context.kind === 'create' || context.kind === 'duplicate' ? 'field|create' : context.kind === 'delete' ? 'field|delete' : 'field|update'];
      if (context.kind === 'update' && context.payload.fieldId.equals(context.table.primaryFieldId())) actions.push('table|update');
      const own = await admit(context.table.id().toString(), actions);
      if (own.isErr()) return own;
      for (const table of context.payload.foreignTables) {
        const foreign = await admit(table.id().toString(), ['table|read']);
        if (foreign.isErr()) return foreign;
      }
      return ok(undefined);
    },
  });
  registerViewOperationPlugin(container, {
    name: 'public-member-resource-ceiling', enforce: 'pre', supports: () => true,
    guard: async (context) => {
      const actions = resolveViewOperationPermissionActions(context);
      return admit(context.payload.tableId, actions);
    },
  });
  const recordActions: Record<RecordWriteOperationKind, Action[]> = {
    createOne: ['record|create'], createMany: ['record|create'], createStream: ['record|create'], submit: ['record|create'],
    duplicate: ['record|read', 'record|create'], duplicateStream: ['record|read', 'record|create'],
    updateOne: ['record|update'], buttonClick: ['record|update'], updateMany: ['record|update'],
    deleteMany: ['record|delete'], archiveMany: ['record|archive'], importAppend: ['record|create'],
    paste: ['record|update'], temporaryPaste: ['record|update'], upsertRecords: ['record|create', 'record|update'], restoreMany: ['record|create'],
  };
  registerRecordWritePlugin(container, {
    name: 'public-member-resource-ceiling', enforce: 'pre', supports: () => true,
    guard: async (context) => {
      const actions = [...recordActions[context.kind]];
      if (context.kind === 'paste' && context.payload.createRecordCount > 0) actions.push('record|create');
      return admit(context.table.id().toString(), actions);
    },
  });
  registerRecordQueryPlugin(container, {
    name: 'public-member-resource-ceiling', enforce: 'pre', supports: () => true,
    guard: (context) => admit(context.table.id().toString(), ['record|read']),
  });
};
