import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ORPCError } from '@orpc/server';
import type { Action } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  mapDomainErrorToHttpError,
  mapTableToDto,
  procedurePolicy,
  type ProcedurePath,
  type ProcedurePolicy,
} from '@teable/v2-contract-http';
import { Table, TableId, v2CoreTokens, type ITableRepository } from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { AuditScope } from '../audit/audit-scope';
import { PermissionService } from '../auth/permission.service';
import { PublicRowAdmissionBusyException } from './public-row-admission-busy.exception';
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';
import { previewForeignTableAuthorizationFailure } from './v2-operation-preview-authorization';
import { registerPublicPermissionPlugins } from './v2-public-permission-plugins';
import {
  V2_PUBLIC_PROCEDURE_HOOK,
  type IV2PublicProcedureHook,
  type IV2PublicProcedureInvocation,
} from './v2-public-procedure-hook';
import { projectReadableFieldMetadata, redactViewMetadata } from './v2-public-view-policy';
type DependencyReader = (tableId: string) => Promise<boolean>;

const inputString = (input: Record<string, unknown>, key: string) =>
  typeof input[key] === 'string' ? (input[key] as string) : undefined;

const httpErrorCode = (status: number): string | undefined => {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 402:
      return 'PAYMENT_REQUIRED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_CONTENT';
    case 429:
      return 'TOO_MANY_REQUESTS';
    case 503:
      return 'SERVICE_UNAVAILABLE';
  }
};

@Injectable()
export class V2PublicProcedureService {
  private readonly scope = new AsyncLocalStorage<IV2PublicProcedureInvocation>();
  private readonly allocations = new WeakMap<IV2PublicProcedureInvocation, Set<string>>();

  constructor(
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    private readonly permissions: PermissionService,
    private readonly cls: ClsService<IClsStore>,
    private readonly prisma: PrismaService,
    private readonly audit: AuditScope,
    private readonly moduleRef: ModuleRef
  ) {}

  current(): IV2PublicProcedureInvocation {
    const invocation = this.scope.getStore();
    if (!invocation)
      throw new ORPCError('UNAUTHORIZED', { message: 'Trusted request scope is required' });
    return invocation;
  }

  registerAllocatedBase(baseId: string): void {
    const invocation = this.current();
    if (invocation.path !== 'bases.create' && invocation.path !== 'bases.duplicate')
      throw new ORPCError('FORBIDDEN', { message: 'This procedure cannot allocate a base' });
    const owned = this.allocations.get(invocation) ?? new Set<string>();
    owned.add(baseId);
    this.allocations.set(invocation, owned);
  }

  async compensateAllocatedBase<T>(
    baseId: string,
    tableIds: readonly string[],
    run: () => Promise<T>
  ): Promise<T> {
    const invocation = this.current();
    if (!this.allocations.get(invocation)?.has(baseId))
      throw new ORPCError('FORBIDDEN', { message: 'Allocation is not owned by this operation' });
    const ids = [...new Set(tableIds)];
    const tables = await this.prisma.tableMeta.findMany({
      where: { baseId },
      select: { id: true },
    });
    if (tables.length !== ids.length || tables.some((table) => !ids.includes(table.id)))
      throw new ORPCError('FORBIDDEN', {
        message: 'Compensation target does not match the owned allocation',
      });
    return this.cls.runWith(
      { ...this.cls.get(), v2PublicCompensation: { baseId, tableIds: ids } },
      run
    );
  }

  private hook(): IV2PublicProcedureHook | undefined {
    try {
      return this.moduleRef.get<IV2PublicProcedureHook>(V2_PUBLIC_PROCEDURE_HOOK, {
        strict: false,
      });
    } catch {
      return undefined;
    }
  }

  async invoke<T>(
    parts: readonly string[],
    rawInput: unknown,
    next: () => Promise<{ output: T; context: object }>
  ): Promise<{ output: T; context: object }> {
    return this.cls.runWith({ ...this.cls.get(), v2PublicProcedure: parts.join('.') }, () =>
      this.invokeScoped(parts, rawInput, next)
    );
  }

  private async invokeScoped<T>(
    parts: readonly string[],
    rawInput: unknown,
    next: () => Promise<{ output: T; context: object }>
  ): Promise<{ output: T; context: object }> {
    const path = parts.join('.') as ProcedurePath;
    const configuredPolicy: ProcedurePolicy | undefined = procedurePolicy[path];
    if (!configuredPolicy)
      throw new ORPCError('FORBIDDEN', { message: 'Procedure has no admission policy' });
    this.assertMember();
    const input =
      rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
        ? (rawInput as Record<string, unknown>)
        : {};
    const policy =
      path === 'tables.delete' && input.mode !== 'permanent'
        ? { ...configuredPolicy, includeInactive: false }
        : configuredPolicy;
    try {
      const resourceId = await this.authorizeProcedure(path, policy, input);
      const invocation = await this.createInvocation(path, policy, input, resourceId);
      const hook = this.hook();
      const execute = async () => {
        registerPublicPermissionPlugins(invocation.container, this.permissions, () => ({
          active: !!this.scope.getStore(),
          tokenId: this.cls.get('accessTokenId'),
          actorId: this.cls.get('user.id'),
          compensation: this.cls.get('v2PublicCompensation'),
        }));
        await hook?.before(invocation);
        const result = await next();
        const filtered = hook ? await hook.after(invocation, result.output) : result.output;
        const output = await this.filterMemberMetadata(filtered);
        return { ...result, output: output as T };
      };
      const run = async () =>
        this.scope.run(invocation, () =>
          hook?.around ? hook.around(invocation, execute) : execute()
        );
      return await this.runAudited(invocation, run);
    } catch (error) {
      this.rethrowPublicError(error);
    }
  }

  private assertMember(): void {
    if (!this.cls.get('user.id')) throw new ORPCError('UNAUTHORIZED');
    if (
      this.cls.get('shareViewId') ||
      this.cls.get('baseShare') ||
      this.cls.get('baseShareId') ||
      this.cls.get('template')
    ) {
      throw new ORPCError('FORBIDDEN', { message: 'Member authentication is required' });
    }
  }

  private resourceId(policy: ProcedurePolicy, input: Record<string, unknown>): string | undefined {
    switch (policy.resource) {
      case 'table':
      case 'optionalTable':
        return inputString(input, 'tableId');
      case 'base':
        return inputString(input, 'baseId');
      case 'space':
        return inputString(input, 'spaceId');
      default:
        return undefined;
    }
  }

  private async authorizeProcedure(
    path: ProcedurePath,
    policy: ProcedurePolicy,
    input: Record<string, unknown>
  ): Promise<string | undefined> {
    const tokenId = this.cls.get('accessTokenId');
    const resourceId =
      path === 'bases.duplicate'
        ? await this.authorizeBaseDuplication(input)
        : this.resourceId(policy, input);
    if (['table', 'base', 'space'].includes(policy.resource) && !resourceId)
      throw new ORPCError('BAD_REQUEST', { message: 'Resource identifier is required' });
    if (resourceId) await this.authorizeResource(path, policy, input, resourceId);
    else await this.authorizeCredentialScope(policy);
    const targetBaseId = inputString(input, 'targetBaseId');
    if (path === 'bases.duplicate' && targetBaseId)
      await this.permissions.validPermissions(targetBaseId, ['base|update'], tokenId);
    const baseId = inputString(input, 'baseId');
    if (path === 'tables.duplicateTable' && baseId)
      await this.permissions.validPermissions(baseId, ['table|create'], tokenId);
    await this.authorizeExplicitReferences(path, input, resourceId);
    return resourceId;
  }

  private async authorizeBaseDuplication(input: Record<string, unknown>): Promise<string> {
    const tokenId = this.cls.get('accessTokenId');
    const sourceBaseId = inputString(input, 'sourceBaseId');
    if (!sourceBaseId)
      throw new ORPCError('BAD_REQUEST', { message: 'Source base identifier is required' });
    await this.permissions.validPermissions(sourceBaseId, ['base|read'], tokenId);
    const source = await this.prisma.base.findUnique({
      where: { id: sourceBaseId },
      select: { spaceId: true },
    });
    if (!source) throw new ORPCError('NOT_FOUND');
    await this.permissions.validPermissions(
      source.spaceId,
      [
        'base|create',
        'table|create',
        'field|create',
        'view|create',
        'record|create',
        'record|read',
      ],
      tokenId
    );
    const sourceTables = await this.prisma.tableMeta.findMany({
      where: { baseId: sourceBaseId, deletedTime: null },
      select: { id: true },
    });
    for (const table of sourceTables)
      await this.permissions.validPermissions(
        table.id,
        [
          'table|read',
          'field|read',
          'view|read',
          ...(input.withRecords ? ['record|read' as const] : []),
        ],
        tokenId
      );
    return source.spaceId;
  }

  private async authorizeResource(
    path: ProcedurePath,
    policy: ProcedurePolicy,
    input: Record<string, unknown>,
    resourceId: string
  ): Promise<void> {
    await this.authorizeViewBinding(policy, input, resourceId);
    const tokenId = this.cls.get('accessTokenId');
    const actions =
      path === 'bases.duplicate'
        ? (['base|create'] as Action[])
        : ([...policy.actions] as Action[]);
    const granted = await this.permissions.validPermissions(
      resourceId,
      actions,
      tokenId,
      policy.includeInactive
    );
    // Selector updates return only a count; record-returning writes need response-read admission.
    const countOnlyUpdate =
      path === 'tables.updateRecords' &&
      input.records === undefined &&
      (input.filter !== undefined || input.recordIds !== undefined);
    if (
      policy.write &&
      !countOnlyUpdate &&
      policy.actions.some((action) => action.startsWith('record|')) &&
      !policy.actions.includes('record|delete')
    ) {
      await this.permissions.validPermissions(
        resourceId,
        ['record|read'],
        tokenId,
        policy.includeInactive
      );
    }
    this.cls.set('permissions', granted as Action[]);
    if (policy.diagnostics)
      await this.permissions.validPermissions(
        resourceId,
        ['table|read', 'field|read'],
        tokenId,
        policy.includeInactive
      );
  }

  private async authorizeViewBinding(
    policy: ProcedurePolicy,
    input: Record<string, unknown>,
    resourceId: string
  ): Promise<void> {
    if (
      typeof input.tableId !== 'string' ||
      (typeof input.viewId !== 'string' && !Array.isArray(input.viewIds))
    )
      return;
    const readable = await this.permissions.getPermissions(
      resourceId,
      this.cls.get('accessTokenId'),
      policy.includeInactive
    );
    if (
      !readable.includes('table|read') &&
      !policy.actions.some((action) => readable.includes(action))
    )
      throw new ORPCError('FORBIDDEN');
    await this.assertViewsBelongToTable(input);
  }

  private async authorizeCredentialScope(policy: ProcedurePolicy): Promise<void> {
    const tokenId = this.cls.get('accessTokenId');
    const granted = tokenId
      ? (await this.permissions.captureCredentialCeiling(tokenId)).scopes
      : undefined;
    if (granted && policy.actions.some((action) => !granted.includes(action))) {
      throw new ORPCError('FORBIDDEN', { message: 'Credential does not grant the required scope' });
    }
    this.cls.set('permissions', granted ? [...granted] : []);
  }

  private async createInvocation(
    path: ProcedurePath,
    policy: ProcedurePolicy,
    input: Record<string, unknown>,
    resourceId?: string
  ): Promise<IV2PublicProcedureInvocation> {
    const tableId =
      inputString(input, 'tableId') ??
      (path === 'operations.preview' && input.input && typeof input.input === 'object'
        ? inputString(input.input as Record<string, unknown>, 'tableId')
        : undefined);
    const baseId =
      inputString(input, 'baseId') ??
      (path === 'bases.duplicate' ? inputString(input, 'sourceBaseId') : undefined);
    const spaceId =
      inputString(input, 'spaceId') ??
      (policy.resource === 'space' ? resourceId : undefined) ??
      (await this.findSpaceId(baseId, tableId));
    const preview =
      path.startsWith('operations.') || path.startsWith('complexity.') || policy.diagnostics;
    const container = await this.resolveContainer(!!preview, tableId, baseId, spaceId);
    if (!container)
      throw new ORPCError('SERVICE_UNAVAILABLE', {
        message: 'A current data route is unavailable',
      });
    return {
      path,
      policy,
      input,
      resourceId,
      spaceId,
      container,
      context: await this.contexts.createContext(container),
      cls: this.cls.get(),
    };
  }

  private async findSpaceId(baseId?: string, tableId?: string): Promise<string | undefined> {
    if (!baseId && !tableId) return undefined;
    const ownerBaseId =
      baseId ??
      (
        await this.prisma.tableMeta.findUnique({
          where: { id: tableId },
          select: { baseId: true },
        })
      )?.baseId;
    if (!ownerBaseId) return undefined;
    return (
      await this.prisma.base.findUnique({
        where: { id: ownerBaseId },
        select: { spaceId: true },
      })
    )?.spaceId;
  }

  private async resolveContainer(
    preview: boolean,
    tableId?: string,
    baseId?: string,
    spaceId?: string
  ) {
    if (preview)
      return tableId
        ? this.containers.getPreviewContainerForTable(tableId)
        : this.containers.getPreviewContainer();
    if (tableId) return this.containers.getContainerForTable(tableId);
    if (baseId) return this.containers.getContainerForBase(baseId);
    if (spaceId) return this.containers.getContainerForSpace(spaceId);
    return this.containers.getContainer();
  }

  private async runAudited<T>(
    invocation: IV2PublicProcedureInvocation,
    run: () => Promise<T>
  ): Promise<T> {
    const { path, policy, input, resourceId } = invocation;
    const audit = policy.audit;
    if (policy.write && !audit)
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Write procedure has no audit decision',
      });
    if (!audit || !('rootAction' in audit)) return await run();
    const rootAction =
      typeof audit.rootAction === 'function' ? audit.rootAction(input) : audit.rootAction;
    return await this.audit.withOperation(
      { rootAction, resourceId, params: { procedure: path } },
      run
    );
  }

  private rethrowPublicError(error: unknown): never {
    if (error instanceof ORPCError) throw error;
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const response =
        error instanceof PublicRowAdmissionBusyException ? error.data : error.getResponse();
      throw new ORPCError(httpErrorCode(status) ?? 'INTERNAL_SERVER_ERROR', {
        status,
        message: error.message,
        data: typeof response === 'object' ? response : undefined,
      });
    }
    throw error;
  }

  private async authorizeExplicitReferences(
    path: ProcedurePath,
    input: Record<string, unknown>,
    rootId?: string
  ): Promise<void> {
    const ids = new Set<string>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (
          (key === 'foreignTableId' || key === 'sourceTableId' || key === 'targetTableId') &&
          typeof child === 'string' &&
          child !== rootId
        )
          ids.add(child);
        // Record cell payloads are data, never authority selectors.
        if ((key !== 'fields' || Array.isArray(child)) && key !== 'records') visit(child);
      }
    };
    visit(input);
    try {
      for (const id of ids)
        await this.permissions.validPermissions(id, ['table|read'], this.cls.get('accessTokenId'));
    } catch (error) {
      const failure =
        path === 'operations.preview' ? previewForeignTableAuthorizationFailure(error) : undefined;
      if (!failure) throw error;
      const mapped = mapDomainErrorToHttpError(failure);
      throw new ORPCError(failure.tags.includes('unauthorized') ? 'UNAUTHORIZED' : 'FORBIDDEN', {
        message: mapped.message,
        data: { domainCode: mapped.code, domainTags: mapped.tags },
      });
    }
    if (typeof input.tableId === 'string' && typeof input.baseId === 'string') {
      const table = await this.prisma.tableMeta.findUnique({
        where: { id: input.tableId },
        select: { baseId: true },
      });
      if (!table || table.baseId !== input.baseId)
        throw new ORPCError('BAD_REQUEST', {
          message: 'Table does not belong to the selected base',
        });
    }
  }

  private async assertViewsBelongToTable(input: Record<string, unknown>): Promise<void> {
    if (typeof input.tableId !== 'string') return;
    const viewIds = [input.viewId, ...(Array.isArray(input.viewIds) ? input.viewIds : [])].filter(
      (id): id is string => typeof id === 'string'
    );
    if (!viewIds.length) return;
    const uniqueIds = [...new Set(viewIds)];
    const count = await this.prisma.view.count({
      where: { id: { in: uniqueIds }, tableId: input.tableId, deletedTime: null },
    });
    if (count !== uniqueIds.length) throw new ORPCError('NOT_FOUND', { message: 'View not found' });
  }

  private dependencyReader(): DependencyReader {
    const grants = new Map<string, Promise<boolean>>();
    return (id) => {
      let allowed = grants.get(id);
      if (!allowed) {
        allowed = this.permissions
          .getPermissions(id, this.cls.get('accessTokenId'))
          .then(
            (permissions) =>
              permissions.includes('table|read') && permissions.includes('field|read')
          )
          .catch((error: unknown) => {
            if (error instanceof HttpException && [401, 403, 404].includes(error.getStatus()))
              return false;
            throw error;
          });
        grants.set(id, allowed);
      }
      return allowed;
    };
  }

  private async filterMemberMetadata(output: unknown): Promise<unknown> {
    if (!output || typeof output !== 'object' || !('data' in output)) return output;
    const data = output.data as Record<string, unknown>;
    if (!data || typeof data !== 'object') return output;
    const invocation = this.current();
    const canReadDependency = this.dependencyReader();
    if (invocation.path === 'tables.listFields' && Array.isArray(data.fields)) {
      data.fields = await projectReadableFieldMetadata(data.fields, canReadDependency);
    }
    const tables = [
      ...(data.table ? [data.table] : []),
      ...(Array.isArray(data.tables) ? data.tables : []),
      ...(Array.isArray(output.data) ? output.data : []),
    ] as Array<Record<string, unknown>>;
    for (const table of tables)
      await this.filterTableMetadata(table, invocation, canReadDependency);
    const tableId = invocation.input.tableId;
    if (typeof tableId === 'string' && (data.view || data.views || data.snapshots))
      await this.filterViewMetadata(data, tableId, invocation, canReadDependency);
    return output;
  }

  private async filterTableMetadata(
    table: Record<string, unknown>,
    invocation: IV2PublicProcedureInvocation,
    canReadDependency: DependencyReader
  ): Promise<void> {
    if (typeof table.id !== 'string') return;
    const grants = await this.permissions.getPermissions(
      table.id,
      this.cls.get('accessTokenId'),
      invocation.policy.includeInactive && table.id === invocation.resourceId
    );
    const fields =
      grants.includes('field|read') && Array.isArray(table.fields)
        ? await projectReadableFieldMetadata(table.fields, canReadDependency)
        : [];
    const readableFieldIds = new Set(
      fields.flatMap((field) => (typeof field.id === 'string' ? [field.id] : []))
    );
    if (Array.isArray(table.fields) && fields.length !== table.fields.length)
      delete table.computeMeta;
    table.fields = fields;
    if (Array.isArray(table.views))
      for (const view of table.views)
        redactViewMetadata(view, { canShare: grants.includes('view|share'), readableFieldIds });
  }

  private async readableFieldIds(
    tableId: string,
    grants: readonly string[],
    invocation: IV2PublicProcedureInvocation,
    canReadDependency: DependencyReader
  ): Promise<Set<string>> {
    if (!grants.includes('field|read')) return new Set();
    const id = TableId.create(tableId);
    if (id.isErr()) throw new ORPCError('INTERNAL_SERVER_ERROR');
    const spec = Table.specs().byId(id.value).build();
    if (spec.isErr()) throw new ORPCError('INTERNAL_SERVER_ERROR');
    const table = await invocation.container
      .resolve<ITableRepository>(v2CoreTokens.tableRepository)
      .findOne(invocation.context, spec.value);
    if (table.isErr()) throw new ORPCError('INTERNAL_SERVER_ERROR');
    const dto = mapTableToDto(table.value);
    if (dto.isErr()) throw new ORPCError('INTERNAL_SERVER_ERROR');
    const fields = await projectReadableFieldMetadata(dto.value.fields, canReadDependency);
    return new Set(fields.flatMap((field) => (typeof field.id === 'string' ? [field.id] : [])));
  }

  private async filterViewMetadata(
    data: Record<string, unknown>,
    tableId: string,
    invocation: IV2PublicProcedureInvocation,
    canReadDependency: DependencyReader
  ): Promise<void> {
    const grants = await this.permissions.getPermissions(tableId, this.cls.get('accessTokenId'));
    const visibility = {
      canShare: grants.includes('view|share'),
      readableFieldIds: await this.readableFieldIds(tableId, grants, invocation, canReadDependency),
    };
    // A snapshot carries the view under `data`; the envelope itself has nothing to redact.
    const snapshots: unknown[] = Array.isArray(data.snapshots) ? data.snapshots : [];
    for (const view of [
      ...(data.view ? [data.view] : []),
      ...(Array.isArray(data.views) ? data.views : []),
      ...snapshots.map((snapshot) => (snapshot as { data?: unknown } | null)?.data),
    ])
      redactViewMetadata(view, visibility);
  }
}
