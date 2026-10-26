/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { Controller, HttpException } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { PrismaService } from '@teable/db-main-prisma';
import type { IComplexityService } from '@teable/v2-command-explain';
import { v2CommandExplainTokens } from '@teable/v2-command-explain';
import { v2Contract } from '@teable/v2-contract-http';
import {
  executeComplexityAssessEndpoint,
  executeComplexityAssessMatrixEndpoint,
  executeCreateTableEndpoint,
  executeDeleteRecordsEndpoint,
  executeGetComputeActivityEndpoint,
  executeGetTableByIdEndpoint,
  executeUpdateRecordsEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import { v2CoreTokens } from '@teable/v2-core';
import type { ICommandBus, IComputedActivityReader, IQueryBus } from '@teable/v2-core' with {
  'resolution-mode': 'import',
};
import { ClsService } from 'nestjs-cls';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResourceMeta } from '../auth/decorators/resource_meta.decorator';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { PermissionService } from '../auth/permission.service';
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';

const throwOrpcErrorByStatus = (status: number, message: string): never => {
  if (status === 400) {
    throw new ORPCError('BAD_REQUEST', { message });
  }

  if (status === 401) {
    throw new ORPCError('UNAUTHORIZED', { message });
  }

  if (status === 403) {
    throw new ORPCError('FORBIDDEN', { message });
  }

  if (status === 404) {
    throw new ORPCError('NOT_FOUND', { message });
  }

  throw new ORPCError('INTERNAL_SERVER_ERROR', { message });
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
