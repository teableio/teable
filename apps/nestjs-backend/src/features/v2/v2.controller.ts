/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { Controller, HttpException } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import type { Action } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
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
  v2Contract,
} from '@teable/v2-contract-http';
import {
  executeComplexityAssessEndpoint,
  executeComplexityAssessMatrixEndpoint,
  executeOperationPreviewCapabilitiesEndpoint,
  executeOperationPreviewEndpoint,
  executeCreateTableEndpoint,
  executeDeleteRecordsEndpoint,
  executeGetComputeActivityEndpoint,
  executeGetTableByIdEndpoint,
  executeUpdateRecordsEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import {
  domainError,
  isForbiddenError,
  isNotFoundError,
  UpdateFieldCommand,
  v2CoreTokens,
} from '@teable/v2-core';
import type {
  DomainError,
  ICommandBus,
  IComputedActivityReader,
  IExecutionContext,
  IQueryBus,
  TableQueryService,
} from '@teable/v2-core' with {
  'resolution-mode': 'import',
};
import type { DependencyContainer } from '@teable/v2-di';
import { ClsService } from 'nestjs-cls';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResourceMeta } from '../auth/decorators/resource_meta.decorator';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { PermissionService } from '../auth/permission.service';
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';
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
  const options = { message, ...(data ? { data } : {}) };

  if (status === 400) throw new ORPCError('BAD_REQUEST', options);
  if (status === 401) throw new ORPCError('UNAUTHORIZED', options);
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
    private readonly prisma: PrismaService
  ) {}

  private async previewContainerFor(request: IOperationPreviewRequestDto) {
    // Base duplication is host-owned and reads routing only through its explicitly non-migrating
    // evidence path. Never route an unparsed caller-selected base through container acquisition.
    if (request.operation === 'base.duplicate') return this.v2Container.getContainer();
    const tableId = previewInputTableId(request.input);
    return tableId
      ? this.v2Container.getPreviewContainerForTable(tableId)
      : this.v2Container.getContainer();
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
    const permissions = V2_OPERATION_PREVIEW_PERMISSIONS[request.operation];
    const tableId = previewInputTableId(request.input);
    if (!permissions || !tableId) return;
    await this.assertCommunityPreviewPermissions(tableId, permissions);
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

  @Implement(v2Contract.operations.preview)
  @TokenAccess()
  operationPreview() {
    return implement(v2Contract.operations.preview).handler(async ({ input }) => {
      const authorizationContainer = await this.v2Container.getContainer();
      this.assertPreviewOperationSupported(input.operation, authorizationContainer);
      const authorizationContext = await this.assertPreviewAuthorization(
        input,
        authorizationContainer
      );
      const container =
        input.operation === 'base.duplicate'
          ? authorizationContainer
          : await this.previewContainerFor(input);
      if (!container) {
        this.throwPreviewDomainError(
          domainError.infrastructure({
            code: 'preview.routing.not_ready',
            message: 'A current read-only data route is unavailable for this preview.',
          })
        );
      }
      const context =
        container === authorizationContainer && authorizationContext
          ? authorizationContext
          : await this.v2ContextFactory.createContext(container);
      const service = container.resolve<IOperationPreviewService>(
        v2CommandExplainTokens.operationPreviewService
      );
      const result = await executeOperationPreviewEndpoint(context, input, service);
      if (result.status === 200) return result.body;
      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }

  @Implement(v2Contract.operations.capabilities)
  @TokenAccess()
  operationPreviewCapabilities() {
    return implement(v2Contract.operations.capabilities).handler(async () => {
      const container = await this.v2Container.getContainer();
      const registry = container.resolve<PreviewPlannerRegistry>(
        v2CommandExplainTokens.previewPlannerRegistry
      );
      const response = executeOperationPreviewCapabilitiesEndpoint(registry).body;
      return { ...response, data: withNestOperationPreviewRoutes(response.data) };
    });
  }

  @Implement(v2Contract.tables.create)
  @Permissions('table|create')
  @ResourceMeta('baseId', 'body')
  createTable() {
    return implement(v2Contract.tables.create).handler(async ({ input }) => {
      const container = await this.v2Container.getContainerForBase(input.baseId);
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const context = await this.v2ContextFactory.createContext(container);

      const result = await executeCreateTableEndpoint(context, input, commandBus);

      if (result.status === 201) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
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
  @Implement(v2Contract.complexity.assess)
  @TokenAccess()
  complexityAssess() {
    return implement(v2Contract.complexity.assess).handler(async ({ input }) => {
      if (input.tableId) await this.assertTableRead(input.tableId);

      const authorizedTableIds = input.tableId
        ? await this.authorizedTableIdsForBase(input.tableId)
        : undefined;
      const container = input.tableId
        ? await this.v2Container.getContainerForTable(input.tableId)
        : await this.v2Container.getContainer();
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
  @Implement(v2Contract.complexity.assessMatrix)
  @TokenAccess()
  complexityAssessMatrix() {
    return implement(v2Contract.complexity.assessMatrix).handler(async ({ input }) => {
      await this.assertTableRead(input.tableId);

      const authorizedTableIds = await this.authorizedTableIdsForBase(input.tableId);
      const container = await this.v2Container.getContainerForTable(input.tableId);
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

  @Implement(v2Contract.tables.getById)
  @Permissions('table|read')
  @ResourceMeta('tableId', 'query')
  getTableById() {
    return implement(v2Contract.tables.getById).handler(async ({ input }) => {
      const container = await this.v2Container.getContainerForTable(input.tableId);
      const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
      const context = await this.v2ContextFactory.createContext(container);
      let activityReader: IComputedActivityReader | undefined;
      try {
        activityReader = container.resolve<IComputedActivityReader>(
          v2CoreTokens.computedActivityReader
        );
      } catch {
        activityReader = undefined;
      }

      const result = await executeGetTableByIdEndpoint(context, input, queryBus, activityReader);
      if (result.status === 200) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }

  @Implement(v2Contract.tables.getComputeActivity)
  @Permissions('table|read')
  @ResourceMeta('tableId', 'query')
  getComputeActivity() {
    return implement(v2Contract.tables.getComputeActivity).handler(async ({ input }) => {
      const container = await this.v2Container.getContainerForTable(input.tableId);
      const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
      const context = await this.v2ContextFactory.createContext(container);

      const result = await executeGetComputeActivityEndpoint(context, input, queryBus);
      if (result.status === 200) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }

  @Implement(v2Contract.tables.deleteRecords)
  @Permissions('record|delete')
  @ResourceMeta('tableId', 'body')
  deleteRecords() {
    return implement(v2Contract.tables.deleteRecords).handler(async ({ input }) => {
      const container = await this.v2Container.getContainerForTable(input.tableId);
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const context = await this.v2ContextFactory.createContext(container);

      const result = await executeDeleteRecordsEndpoint(context, input, commandBus);

      if (result.status === 200) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }

  @Implement(v2Contract.tables.updateRecords)
  @Permissions('record|update')
  @ResourceMeta('tableId', 'body')
  updateRecords() {
    return implement(v2Contract.tables.updateRecords).handler(async ({ input }) => {
      const container = await this.v2Container.getContainerForTable(input.tableId);
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const context = await this.v2ContextFactory.createContext(container);

      const result = await executeUpdateRecordsEndpoint(context, input, commandBus);

      if (result.status === 200) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }
}
