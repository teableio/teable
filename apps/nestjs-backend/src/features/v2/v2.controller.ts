/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { Controller, ForbiddenException, HttpException, Req } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { DecoratedProcedure, isProcedure, type AnyRouter } from '@orpc/server';
import type { Request } from 'express';
import { convertFieldRoSchema, type Action } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IGetRecordsRo } from '@teable/openapi';
import type {
  IComplexityService,
  IOperationPreviewService,
  PreviewPlannerRegistry,
} from '@teable/v2-command-explain';
import { isPreviewOperation, v2CommandExplainTokens } from '@teable/v2-command-explain';
import {
  type IApiErrorResponseDto,
  type IOperationPreviewRequestDto,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  v2MemberContract,
} from '@teable/v2-contract-http';
import {
  executeComplexityAssessEndpoint,
  executeComplexityAssessMatrixEndpoint,
  executeOperationPreviewCapabilitiesEndpoint,
  executeOperationPreviewEndpoint,
  executeDuplicateBaseEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import { createV2OrpcRouter } from '@teable/v2-contract-http-implementation';
import {
  domainError,
  isForbiddenError,
  isNotFoundError,
  UpdateFieldCommand,
  DeleteTableCommand,
  v2CoreTokens,
} from '@teable/v2-core';
import type {
  DomainError,
  ICommandBus,
  IExecutionContext,
  TableQueryService,
} from '@teable/v2-core' with {
  'resolution-mode': 'import',
};
import type { DependencyContainer } from '@teable/v2-di';
import { ClsService } from 'nestjs-cls';
import { DisabledPermission } from '../auth/decorators/disabled-permission.decorator';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { PermissionService } from '../auth/permission.service';
import { getBaseShareHeader, getShareViewHeader, getTemplateHeader } from '../auth/utils';
import { BaseService } from '../base/base.service';
import { BasePersonalOrderService } from '../base/base-personal-order.service';
import { CacheService } from '../../cache/cache.service';
import { V2WorkflowService } from './workflows/v2-workflow.service';
import { FieldOpenApiV2Service } from '../field/open-api/field-open-api-v2.service';
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';
import { V2PublicProcedureService } from './v2-public-procedure.service';
import {
  captureFieldPreviewSource,
  captureFieldPreviewRoute,
  fieldPreviewRoute,
} from './v2-field-preview-input';
import {
  authorizeFieldConversionForeignTables,
  type IV2OperationPreviewAuthorization,
  previewAuthorizationDomainError,
  V2_OPERATION_PREVIEW_AUTHORIZATION,
  V2_OPERATION_PREVIEW_PERMISSIONS,
} from './v2-operation-preview-authorization';
import { withNestOperationPreviewRoutes } from './v2-operation-preview-capabilities';

const throwOrpcErrorByStatus = (
  status: number,
  error: string | IApiErrorResponseDto['error']
): never => {
  const message = typeof error === 'string' ? error : error.message;
  const data =
    typeof error === 'string'
      ? undefined
      : {
          domainCode: error.code,
          domainTags: error.tags,
          details: error.details,
          localization: error.localization,
        };
  const options = { message, status, ...(data ? { data } : {}) };

  if (status === 400) throw new ORPCError('BAD_REQUEST', options);
  if (status === 401) throw new ORPCError('UNAUTHORIZED', options);
  if (status === 402) throw new ORPCError('PAYMENT_REQUIRED', options);
  if (status === 403) throw new ORPCError('FORBIDDEN', options);
  if (status === 404) throw new ORPCError('NOT_FOUND', options);
  if (status === 409) throw new ORPCError('CONFLICT', options);
  if (status === 501) throw new ORPCError('NOT_IMPLEMENTED', options);
  if (status === 503) throw new ORPCError('SERVICE_UNAVAILABLE', options);
  if (status === 504) throw new ORPCError('GATEWAY_TIMEOUT', options);
  throw new ORPCError('INTERNAL_SERVER_ERROR', options);
};

const previewInputTableId = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return 'tableId' in value && typeof value.tableId === 'string' ? value.tableId : undefined;
};

@Controller('api/v2')
export class V2Controller {
  constructor(
    private readonly v2Container: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly permissionService: PermissionService,
    private readonly cls: ClsService,
    private readonly prisma: PrismaService,
    private readonly publicProcedures: V2PublicProcedureService,
    private readonly bases: BaseService,
    private readonly baseOrder: BasePersonalOrderService,
    private readonly cache: CacheService,
    private readonly workflows: V2WorkflowService,
    private readonly moduleRef?: ModuleRef
  ) {}

  @Implement(v2MemberContract)
  @TokenAccess()
  @DisabledPermission()
  member(@Req() request: Request) {
    if (getBaseShareHeader(request) || getShareViewHeader(request) || getTemplateHeader(request)) throw new ForbiddenException();
    const windowId = request.headers['x-window-id'];
    if (typeof windowId === 'string') this.cls.set('windowId', windowId);
    const router = createV2OrpcRouter({
      createContainer: () => this.publicProcedures.current().container,
      createExecutionContext: () => this.publicProcedures.current().context,
      basesHost: {
        create: async (input) => {
          let allocatedId: string | undefined;
          try {
            const base = await this.bases.createBase(input, { onAllocated: (id) => { allocatedId = id; this.publicProcedures.registerAllocatedBase(id); } });
            return { ok: true, data: { base } };
          } catch (error) {
            if (allocatedId) await this.publicProcedures.compensateAllocatedBase(allocatedId, [], () => this.bases.cleanupAllocatedBase(allocatedId!));
            throw error;
          }
        },
        list: async ({ offset, limit, orderBy, ...filter }) => {
          const candidates = orderBy === 'personal'
            ? await this.baseOrder.sortForUser(await this.bases.getAllBaseList(filter))
            : await this.bases.getAllBaseList({ ...filter, skip: offset, take: limit + 1 });
          const page = orderBy === 'personal' ? candidates.slice(offset, offset + limit + 1) : candidates;
          return { ok: true, data: { bases: page.slice(0, limit), hasMore: page.length > limit } };
        },
        duplicate: async (input) => {
          const source = await this.prisma.base.findUniqueOrThrow({ where: { id: input.sourceBaseId }, select: { spaceId: true, name: true } });
          let allocatedId: string | undefined;
          try {
            const target = await this.bases.createBase({ spaceId: source.spaceId, name: input.name ?? `${source.name ?? ''} (Copy)` }, { onAllocated: (id) => { allocatedId = id; this.publicProcedures.registerAllocatedBase(id); } });
            const { context, container } = this.publicProcedures.current();
            const result = await executeDuplicateBaseEndpoint(context, { ...input, targetBaseId: target.id }, container.resolve<ICommandBus>(v2CoreTokens.commandBus), { adoptExistingTarget: true });
            if (result.status !== 201) throwOrpcErrorByStatus(result.status, result.body.error);
            return result.body;
          } catch (error) {
            if (allocatedId) await this.rollbackAllocatedDuplicate(allocatedId);
            throw error;
          }
        },
      },
      workflowHost: this.workflows.createBindings(),
      prepareListRecords: async (input) => {
        if (!input.queryId) return input;
        const cached = await this.cache.get(`query-params:${input.queryId}`);
        return cached ? { ...input, collapsedGroupIds: (cached.queryParams as IGetRecordsRo)?.collapsedGroupIds } : input;
      },
    });
    const os = implement(v2MemberContract);
    // Nest mounts each leaf separately and does not supply its logical router path.
    // router() enhances leaves into plain Procedure objects; restore the builder before use().
    const bind = (node: AnyRouter, path: string[] = []): AnyRouter => Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, isProcedure(value)
        ? new DecoratedProcedure(value['~orpc']).use(async ({ next }, input) => this.publicProcedures.invoke([...path, key], input, () => next()))
        : bind(value, [...path, key])])
    );
    return bind(os.router({
      bases: router.bases,
      workflows: router.workflows,
      tables: router.tables,
      operations: { preview: this.operationPreview(), capabilities: this.operationPreviewCapabilities() },
      complexity: { assess: this.complexityAssess(), assessMatrix: this.complexityAssessMatrix() },
    }));
  }

  private async rollbackAllocatedDuplicate(baseId: string): Promise<void> {
    const { container, context } = this.publicProcedures.current();
    const tableIds = await this.prisma.tableMeta.findMany({ where: { baseId }, select: { id: true } });
    await this.publicProcedures.compensateAllocatedBase(baseId, tableIds.map((table) => table.id), async () => {
      const bus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      for (const table of tableIds.reverse()) {
        const command = DeleteTableCommand.create({ baseId, tableId: table.id, mode: 'permanent' });
        if (command.isErr()) throw new Error(command.error.message);
        const deleted = await bus.execute(context, command.value);
        if (deleted.isErr()) throw new Error(deleted.error.message);
      }
      await this.bases.cleanupAllocatedBase(baseId);
    });
  }

  private async previewContainerFor(_request: IOperationPreviewRequestDto) {
    return this.publicProcedures.current().container;
  }

  private throwPreviewDomainError(error: DomainError): never {
    throwOrpcErrorByStatus(mapDomainErrorToHttpStatus(error), mapDomainErrorToHttpError(error));
  }

  private assertPreviewOperationSupported(operation: string, container: DependencyContainer): void {
    const registry = container.resolve<PreviewPlannerRegistry>(
      v2CommandExplainTokens.previewPlannerRegistry
    );
    const result = registry.resolve(operation);
    if (result.isErr()) this.throwPreviewDomainError(result.error);
  }

  private async assertCommunityPreviewAuthorization(
    request: IOperationPreviewRequestDto,
    container: DependencyContainer
  ): Promise<IExecutionContext | undefined> {
    if (!isPreviewOperation(request.operation)) return;
    if (request.operation === 'base.duplicate') {
      const input = request.input && typeof request.input === 'object' ? request.input as Record<string, unknown> : {};
      if (typeof input.sourceBaseId !== 'string') throw new ORPCError('BAD_REQUEST');
      await this.assertCommunityPreviewPermissions(input.sourceBaseId, ['base|read']);
      const tables = await this.prisma.tableMeta.findMany({ where: { baseId: input.sourceBaseId, deletedTime: null }, select: { id: true } });
      for (const table of tables) await this.assertCommunityPreviewPermissions(table.id, ['table|read', 'field|read', 'view|read', 'record|read']);
      return;
    }
    const permissions = V2_OPERATION_PREVIEW_PERMISSIONS[request.operation];
    const tableId = previewInputTableId(request.input);
    if (!permissions || !tableId) return;
    await this.assertCommunityPreviewPermissions(tableId, [...permissions, 'table|read', 'field|read']);
    if (request.operation !== 'field.convert') return;
    return this.previewFieldConversionContext(request, container);
  }

  private async assertCommunityPreviewPermissions(
    tableId: string,
    permissions: readonly Action[]
  ): Promise<void> {
    try {
      await this.permissionService.validPermissions(
        tableId,
        [...permissions],
        this.cls.get('accessTokenId')
      );
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      this.throwPreviewDomainError(previewAuthorizationDomainError(error.getStatus()));
    }
  }

  private async previewFieldConversionContext(
    request: IOperationPreviewRequestDto,
    container: DependencyContainer
  ): Promise<IExecutionContext> {
    const command = UpdateFieldCommand.create(request.input, { allowNoop: true });
    if (command.isErr()) this.throwPreviewDomainError(command.error);
    const context = await this.v2ContextFactory.createContext(container);
    const table = await container
      .resolve<TableQueryService>(v2CoreTokens.tableQueryService)
      .getById(context, command.value.tableId);
    if (table.isErr()) {
      this.throwPreviewDomainError(
        isNotFoundError(table.error) || isForbiddenError(table.error)
          ? domainError.forbidden({
              code: 'preview.authorization.forbidden',
              message: 'You do not have permission to preview this operation.',
            })
          : table.error
      );
    }
    const foreignAdmission = await authorizeFieldConversionForeignTables(
      command.value,
      table.value,
      this.permissionService,
      this.cls.get('accessTokenId')
    );
    if (foreignAdmission.isErr()) this.throwPreviewDomainError(foreignAdmission.error);
    return context;
  }

  private async assertPreviewAuthorization(
    request: IOperationPreviewRequestDto,
    container: DependencyContainer
  ): Promise<IExecutionContext | undefined> {
    if (container.isRegistered(V2_OPERATION_PREVIEW_AUTHORIZATION)) {
      const context = await this.v2ContextFactory.createContext(container);
      const authorization = container.resolve<IV2OperationPreviewAuthorization>(
        V2_OPERATION_PREVIEW_AUTHORIZATION
      );
      const result = await authorization.authorize(context, request, container);
      if (result.isErr()) this.throwPreviewDomainError(result.error);
      return context;
    }

    return this.assertCommunityPreviewAuthorization(request, container);
  }

  private async normalizeFieldPreview(
    request: IOperationPreviewRequestDto,
    authorizationContainer: DependencyContainer
  ) {
    const raw = request.input;
    if (
      request.operation !== 'field.convert' ||
      typeof raw !== 'object' ||
      raw === null ||
      !('inputFormat' in raw)
    )
      return request;
    if (raw.inputFormat !== 'field-openapi') {
      this.throwPreviewDomainError(
        domainError.validation({ message: 'Unsupported field preview input format' })
      );
    }
    const identity = UpdateFieldCommand.create(
      { tableId: raw.tableId, fieldId: raw.fieldId, field: {} },
      { allowNoop: true }
    );
    if (identity.isErr()) this.throwPreviewDomainError(identity.error);
    const field = convertFieldRoSchema.safeParse(raw.field);
    if (!field.success)
      this.throwPreviewDomainError(
        domainError.validation({ message: 'Invalid OpenAPI field conversion input' })
      );
    if (authorizationContainer.isRegistered(V2_OPERATION_PREVIEW_AUTHORIZATION)) {
      const admissionContext = await this.v2ContextFactory.createContext(authorizationContainer);
      const sourceAdmission = await authorizationContainer
        .resolve<IV2OperationPreviewAuthorization>(V2_OPERATION_PREVIEW_AUTHORIZATION)
        .authorize(
          admissionContext,
          {
            operation: 'field.convert',
            input: { tableId: raw.tableId, fieldId: raw.fieldId, field: {} },
          },
          authorizationContainer
        );
      if (sourceAdmission.isErr()) this.throwPreviewDomainError(sourceAdmission.error);
    } else {
      await this.assertCommunityPreviewPermissions(raw.tableId, ['field|update']);
    }
    const container = await this.previewContainerFor(request);
    if (!container)
      this.throwPreviewDomainError(
        domainError.infrastructure({
          code: 'preview.routing.not_ready',
          message: 'A current read-only data route is unavailable for this preview.',
        })
      );
    const context = await this.v2ContextFactory.createContext(container);
    const table = await container
      .resolve<TableQueryService>(v2CoreTokens.tableQueryService)
      .getById(context, identity.value.tableId);
    if (table.isErr()) this.throwPreviewDomainError(table.error);
    if (raw.baseId !== undefined && raw.baseId !== table.value.baseId().toString()) {
      this.throwPreviewDomainError(
        domainError.validation({ message: 'Field conversion base does not match the source table' })
      );
    }
    const fields = this.moduleRef?.get(FieldOpenApiV2Service, { strict: false });
    if (!fields)
      this.throwPreviewDomainError(
        domainError.infrastructure({ message: 'Field conversion normalization is unavailable' })
      );
    const normalized = fields.prepareConvertFieldInput(table.value, raw.fieldId, field.data);
    if (normalized.isErr()) this.throwPreviewDomainError(normalized.error);
    captureFieldPreviewSource(normalized.value, table.value);
    captureFieldPreviewRoute(normalized.value, { container, context });
    return { ...request, input: normalized.value };
  }

  operationPreview() {
    return implement(v2MemberContract.operations.preview).handler(async ({ input }) => {
      const authorizationContainer = await this.v2Container.getContainer();
      this.assertPreviewOperationSupported(input.operation, authorizationContainer);
      input = await this.normalizeFieldPreview(input, authorizationContainer);
      const authorizationContext = await this.assertPreviewAuthorization(
        input,
        authorizationContainer
      );
      const capturedRoute = fieldPreviewRoute(input.input);
      const container =
        capturedRoute?.container ??
        (input.operation === 'base.duplicate'
          ? authorizationContainer
          : await this.previewContainerFor(input));
      if (!container) {
        this.throwPreviewDomainError(
          domainError.infrastructure({
            code: 'preview.routing.not_ready',
            message: 'A current read-only data route is unavailable for this preview.',
          })
        );
      }
      const context =
        capturedRoute?.context ??
        (container === authorizationContainer && authorizationContext
          ? authorizationContext
          : await this.v2ContextFactory.createContext(container));
      const service = container.resolve<IOperationPreviewService>(
        v2CommandExplainTokens.operationPreviewService
      );
      const result = await executeOperationPreviewEndpoint(context, input, service);
      if (result.status === 200) return result.body;
      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }

  operationPreviewCapabilities() {
    return implement(v2MemberContract.operations.capabilities).handler(async () => {
      const container = await this.v2Container.getContainer();
      const registry = container.resolve<PreviewPlannerRegistry>(
        v2CommandExplainTokens.previewPlannerRegistry
      );
      const response = executeOperationPreviewCapabilitiesEndpoint(registry).body;
      return { ...response, data: withNestOperationPreviewRoutes(response.data) };
    });
  }


  private async authorizedTableIdsForBase(tableId: string): Promise<string[]> {
    const seed = await this.prisma.tableMeta.findUnique({
      where: { id: tableId },
      select: { baseId: true },
    });
    if (!seed) return [];
    const where = { baseId: seed.baseId, deletedTime: null };
    const total = await this.prisma.tableMeta.count({ where });
    const tokenId = this.cls.get('accessTokenId');
    if (total > 200) {
      const seedPermissions = await this.permissionService
        .getPermissions(tableId, tokenId)
        .catch(() => [] as string[]);
      return seedPermissions.includes('table|read') ? [tableId] : [];
    }
    const tables = await this.prisma.tableMeta.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const authorized: string[] = [];
    const batchSize = 8;
    for (let start = 0; start < tables.length; start += batchSize) {
      const checked = await Promise.all(
        tables.slice(start, start + batchSize).map(async (table) => ({
          id: table.id,
          // A table the actor cannot read is simply left out of the closure.
          permissions: await this.permissionService
            .getPermissions(table.id, tokenId)
            .catch(() => [] as string[]),
        }))
      );
      for (const table of checked) {
        if (table.permissions.includes('table|read')) authorized.push(table.id);
      }
    }
    return authorized;
  }

  /** Nest HttpExceptions are not oRPC errors; unmapped they surface as a bare 500. */
  private async assertTableRead(tableId: string): Promise<void> {
    try {
      await this.permissionService.validPermissions(
        tableId,
        ['table|read'],
        this.cls.get('accessTokenId')
      );
    } catch (error) {
      if (error instanceof HttpException) throwOrpcErrorByStatus(error.getStatus(), error.message);
      throw error;
    }
  }

  /**
   * Permission contract:
   * - schema mode performs no database access; any authenticated actor may run it.
   * - tableId mode requires `table|read` on the seed table. Catalog statistics
   *   read base-wide aggregates under that same base membership, never record
   *   values.
   */
  complexityAssess() {
    return implement(v2MemberContract.complexity.assess).handler(async ({ input }) => {
      if (input.tableId) await this.assertTableRead(input.tableId);

      const authorizedTableIds = input.tableId
        ? await this.authorizedTableIdsForBase(input.tableId)
        : undefined;
      const container = this.publicProcedures.current().container;
      const context = await this.v2ContextFactory.createContext(container);
      const service = container.resolve<IComplexityService>(
        v2CommandExplainTokens.complexityService
      );
      const result = await executeComplexityAssessEndpoint(
        context,
        input.tableId ? { ...input, authorizedTableIds } : input,
        service
      );

      if (result.status === 200) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }

  /** Matrix reads the same metadata as `complexityAssess`; it always names a table. */
  complexityAssessMatrix() {
    return implement(v2MemberContract.complexity.assessMatrix).handler(async ({ input }) => {
      await this.assertTableRead(input.tableId);

      const authorizedTableIds = await this.authorizedTableIdsForBase(input.tableId);
      const container = this.publicProcedures.current().container;
      const context = await this.v2ContextFactory.createContext(container);
      const service = container.resolve<IComplexityService>(
        v2CommandExplainTokens.complexityService
      );
      const result = await executeComplexityAssessMatrixEndpoint(
        context,
        { ...input, authorizedTableIds },
        service
      );

      if (result.status === 200) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }

}
