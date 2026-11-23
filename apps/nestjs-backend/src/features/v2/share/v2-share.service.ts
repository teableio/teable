import { ForbiddenException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import type { Action } from '@teable/core';
import { FieldKeyType, isAnonymous, ViewType } from '@teable/core';
import type { DomainError } from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import type { IShareHostBindings } from '@teable/v2-contract-http-implementation';
import {
  AggregateTableRecordsQuery, buildSanitizedRecordConditionSpec, collectFilterFieldIds,
  CountTableRecordsQuery, FieldClipboardValueVisitor, ListTableRecordsQuery,
  replaceCurrentUserTagInFilter, stringifyClipboardRows, TableId, v2CoreTokens,
} from '@teable/v2-core';
import type {
  AggregateTableRecordsResult, CountTableRecordsResult, IExecutionContext, IQueryBus,
  ListTableRecordsResult, RecordFilter, RecordQueryPluginScope, Table, TableQueryService,
} from '@teable/v2-core';
import type { Request, Response } from 'express';
import cookie from 'cookie';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { AuditScope } from '../../audit/audit-scope';
import { PermissionService } from '../../auth/permission.service';
import { RecordOpenApiV2Service } from '../../record/open-api/record-open-api-v2.service';
import { ShareAuthService, type IShareViewInfo } from '../../share/share-auth.service';
import { V2ContainerService } from '../v2-container.service';
import { V2ExecutionContextFactory } from '../v2-execution-context.factory';
import { throwV2Error } from '../v2-http-error';
import { V2_SHARE_WRITE_ADMISSION, type IV2ShareWriteAdmission } from './v2-share-write-admission';

type Input<K extends keyof IShareHostBindings> = Parameters<IShareHostBindings[K]>[0];
type Scope = {
  tableId: string; viewId: string; table: Table; context: IExecutionContext; bus: IQueryBus;
  visible: string[]; queryScope: RecordQueryPluginScope;
  info: IShareViewInfo;
};

/** Public share policy is resolved afresh per call, independently of member authorization. */
@Injectable()
export class V2ShareService {
  constructor(
    private readonly auth: ShareAuthService,
    private readonly permissions: PermissionService,
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    private readonly records: RecordOpenApiV2Service,
    private readonly cls: ClsService<IClsStore>,
    private readonly audit: AuditScope,
    @Optional() @Inject(V2_SHARE_WRITE_ADMISSION)
    private readonly writeAdmission?: IV2ShareWriteAdmission
  ) {}

  private unwrap<T>(result: Result<T, DomainError>): T {
    if (result.isErr()) throwV2Error(result.error, mapDomainErrorToHttpStatus(result.error));
    return result.value;
  }


  private async current(shareId: string) {
    const info = await this.auth.findShareViewInfo(shareId, true);
    if (!info || !info.view || info.view.shareId !== shareId || !info.view.enableShare) throw new NotFoundException();
    return info;
  }

  private async scope(shareId: string, req: Request, action: Action, submit = false): Promise<Scope> {
    const info = await this.current(shareId);
    if (info.shareMeta?.password && !(await this.permissions.validateShareViewPasswordToken(
      shareId, cookie.parse(req.headers.cookie ?? '')[shareId] ?? ''
    ))) throw new UnauthorizedException();
    if (submit && info.view?.type !== ViewType.Form) throw new ForbiddenException();
    if (submit && info.shareMeta?.submit?.requireLogin && isAnonymous(this.cls.get('user.id'))) throw new UnauthorizedException();
    this.cls.set('useV2', true);
    this.cls.set('shareViewId', shareId);
    let granted: Action[] = submit
      ? ['record|create']
      : await this.permissions.validShareViewPermissions(shareId, info.tableId, [action]);
    // A share never widens the resource or action ceiling of a supplied access token.
    const tokenId = this.cls.get('accessTokenId');
    if (tokenId) {
      const ceiling = await this.permissions.getPermissionsByAccessToken(info.tableId, tokenId);
      granted = granted.filter((permission) => ceiling.includes(permission));
      if (!granted.includes(action)) throw new ForbiddenException();
    }
    // Nested typecast must retain the share's lack of field/schema permissions.
    this.cls.set('permissions', granted);
    if (!submit && action !== 'view|read' && !info.shareMeta?.includeRecords) throw new ForbiddenException();
    const container = await this.containers.getContainerForTable(info.tableId);
    const context = await this.contexts.createContext(container);
    const table = this.unwrap(await container.resolve<TableQueryService>(v2CoreTokens.tableQueryService)
      .getById(context, this.unwrap(TableId.create(info.tableId))));
    const viewId = info.view!.id;
    const view = this.unwrap(table.getViewById(viewId));
    // Recheck the same current share against the exact native table/view snapshot.
    if (!view.enableShare() || view.shareId() !== shareId) throw new NotFoundException();
    const visible = this.unwrap(table.getOrderedVisibleFieldIds(viewId, {
      includeHiddenFields: info.shareMeta?.includeHiddenField === true,
    })).map((id) => id.toString());
    const defaults = this.unwrap(view.queryDefaults());
    // Trusted saved filters can depend on hidden fields. Keep them as an immutable row spec,
    // so readable-field sanitization can never remove a share restriction.
    const recordSpec = this.unwrap(buildSanitizedRecordConditionSpec(table,
      replaceCurrentUserTagInFilter(table, defaults.filter(), context.actorId.toString())));
    return {
      tableId: info.tableId, viewId, info, table, context,
      bus: container.resolve<IQueryBus>(v2CoreTokens.queryBus), visible,
      queryScope: { readableFieldIds: new Set(visible), recordSpec },
    };
  }

  private assertFields(scope: Scope, ids: Iterable<string>) {
    const allowed = new Set(scope.visible);
    for (const id of ids) if (!allowed.has(id)) throw new ForbiddenException();
  }

  private validateQuery(scope: Scope, input: Pick<Input<'listRecords'>, 'projection' | 'filter' | 'sort' | 'search'>) {
    const ids = new Set(input.projection ?? []);
    collectFilterFieldIds(input.filter as RecordFilter | undefined, ids);
    input.sort?.forEach(({ fieldId }) => ids.add(fieldId));
    input.search?.[1]?.split(',').map((id) => id.trim()).filter(Boolean).forEach((id) => ids.add(id));
    this.assertFields(scope, ids);
  }

  private async list(scope: Scope, input: Input<'listRecords'>, selectedRecordIds?: string[]) {
    this.validateQuery(scope, input);
    const query = this.unwrap(ListTableRecordsQuery.create({
      tableId: scope.tableId, viewId: scope.viewId, fieldKeyType: FieldKeyType.Id,
      filter: input.filter, sort: input.sort, search: input.search,
      projection: input.projection ?? scope.visible, selectedRecordIds,
      limit: input.limit, offset: input.offset, includeTotal: false,
    }, { table: scope.table, queryScope: scope.queryScope, searchFieldIds: scope.visible, requireReadableSearchFields: true }));
    return this.unwrap(await scope.bus.execute<ListTableRecordsQuery, ListTableRecordsResult>(scope.context, query));
  }

  private async visibleIds(scope: Scope, shareId: string, recordIds: string[]) {
    const ids = [...new Set(recordIds)];
    const result = await this.list(scope, { shareId, limit: ids.length, offset: 0 }, ids);
    const visibleIds = new Set(result.records.map(({ id }) => id));
    if (ids.some((id) => !visibleIds.has(id))) throw new NotFoundException();
  }

  private async write<T>(scope: Scope, next: () => Promise<T>): Promise<T> {
    if (!this.writeAdmission) return next();
    return this.writeAdmission.around({
      shareId: scope.info.shareId,
      tableId: scope.tableId,
      baseId: scope.table.baseId().toString(),
      context: scope.context,
    }, next);
  }

  bind(req: Request, res: Response): IShareHostBindings {
    return {
      authenticate: async ({ shareId, password }) => {
        const info = await this.current(shareId);
        if (!(await this.auth.authShareView(shareId, password, true, this.cls.get('user.id')))) throw new UnauthorizedException();
        // The token hashes the current password and the share ID; a password change or
        // share revocation invalidates it on the next request, including form submissions.
        const token = await this.auth.authToken(shareId, info.shareMeta?.password ?? password);
        res.cookie(shareId, token, { httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/', maxAge: 604800000 });
        return { token };
      },
      get: async ({ shareId }) => {
        const scope = await this.scope(shareId, req, 'view|read');
        const permissions = this.cls.get('permissions');
        const view = scope.info.view!;
        return {
          shareId, view: { id: view.id, name: view.name, type: view.type },
          fields: scope.visible.map((id) => {
            const field = scope.table.getFields().find((field) => field.id().toString() === id)!;
            return { id, name: field.name().toString(), type: field.type().toString(), isPrimary: field.id().equals(scope.table.primaryFieldId()), isComputed: field.computed().toBoolean() };
          }),
          capabilities: { read: scope.info.shareMeta?.includeRecords === true, copy: permissions.includes('record|copy'), edit: permissions.includes('record|update'), submit: view.type === ViewType.Form, requireLogin: scope.info.shareMeta?.submit?.requireLogin === true },
        };
      },
      listRecords: async (input) => {
        const scope = await this.scope(input.shareId, req, 'record|read');
        const result = await this.list(scope, input);
        return { records: result.records.map(({ id, fields }) => ({ id, fields: Object.fromEntries(Object.entries(fields).filter(([id]) => scope.visible.includes(id))) })) };
      },
      getRecord: async ({ shareId, recordId }) => {
        const scope = await this.scope(shareId, req, 'record|read');
        const result = await this.list(scope, { shareId, limit: 1, offset: 0 }, [recordId]);
        const record = result.records.find(({ id }) => id === recordId);
        if (!record) throw new NotFoundException();
        return { id: record.id, fields: Object.fromEntries(Object.entries(record.fields).filter(([id]) => scope.visible.includes(id))) };
      },
      countRecords: async (input) => {
        const scope = await this.scope(input.shareId, req, 'record|read');
        this.validateQuery(scope, input);
        const query = this.unwrap(CountTableRecordsQuery.create({ tableId: scope.tableId, viewId: scope.viewId, filter: input.filter, search: input.search, projection: input.projection ?? scope.visible, fieldKeyType: FieldKeyType.Id }, { table: scope.table, queryScope: scope.queryScope, searchFieldIds: scope.visible }));
        const result = this.unwrap(await scope.bus.execute<CountTableRecordsQuery, CountTableRecordsResult>(scope.context, query));
        return { count: result.count };
      },
      aggregateRecords: async (input) => {
        const scope = await this.scope(input.shareId, req, 'record|read');
        this.validateQuery(scope, input);
        this.assertFields(scope, input.metrics.map(({ fieldId }) => fieldId));
        const query = this.unwrap(AggregateTableRecordsQuery.create({ tableId: scope.tableId, viewId: scope.viewId, filter: input.filter, search: input.search, fields: input.metrics }, { table: scope.table, queryScope: scope.queryScope }));
        const result = this.unwrap(await scope.bus.execute<AggregateTableRecordsQuery, AggregateTableRecordsResult>(scope.context, query));
        return { aggregations: result.values.map(({ fieldId, statisticFunc, value }) => ({ fieldId: fieldId.toString(), total: { aggFunc: statisticFunc, value } })) };
      },
      copy: async (input) => {
        const scope = await this.scope(input.shareId, req, 'record|copy');
        const result = await this.list(scope, input);
        const fieldMap = new Map(scope.table.getFields().map((field) => [field.id().toString(), field]));
        const selectedFields = input.projection ?? scope.visible;
        const content = stringifyClipboardRows(result.records.map((record) => selectedFields.map((id) => this.unwrap(fieldMap.get(id)!.accept(new FieldClipboardValueVisitor(record.fields[id]))))));
        await this.audit.emitAtomic({
          action: 'shared.view.copy', resourceId: input.shareId,
          userId: this.cls.get('user.id'),
          params: { shareId: input.shareId, tableId: scope.tableId, viewId: scope.viewId },
        });
        return { content };
      },
      submitRecord: async ({ shareId, fields, typecast }) => {
        const scope = await this.scope(shareId, req, 'record|create', true);
        this.assertFields(scope, Object.keys(fields));
        const record = await this.write(scope, () => this.records.formSubmit(scope.tableId, { viewId: scope.viewId, fields, typecast }, { shareId }));
        return { id: record.id };
      },
      createRecords: async ({ shareId, records, typecast }) => {
        const scope = await this.scope(shareId, req, 'record|create');
        this.assertFields(scope, records.flatMap(({ fields }) => Object.keys(fields)));
        const result = await this.write(scope, () => this.records.createRecords(scope.tableId, { records, fieldKeyType: FieldKeyType.Id, typecast }));
        return { recordIds: result.records.map(({ id }) => id) };
      },
      updateRecord: async ({ shareId, recordId, fields, typecast }) => {
        const scope = await this.scope(shareId, req, 'record|update');
        this.assertFields(scope, Object.keys(fields));
        await this.visibleIds(scope, shareId, [recordId]);
        const record = await this.write(scope, () => this.records.updateRecord(scope.tableId, recordId, { record: { fields }, fieldKeyType: FieldKeyType.Id, typecast }));
        return { id: record.id };
      },
      deleteRecords: async ({ shareId, recordIds }) => {
        const scope = await this.scope(shareId, req, 'record|delete');
        await this.visibleIds(scope, shareId, recordIds);
        return { deletedRecordIds: await this.records.deleteRecordsByIds(scope.tableId, [...new Set(recordIds)]) };
      },
    };
  }
}
