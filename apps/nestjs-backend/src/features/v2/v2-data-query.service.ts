import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_ROBOT_ID, isAnonymous, isRobot } from '@teable/core';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { PostgresDataQueryExecutor } from '@teable/v2-adapter-table-repository-postgres';
import type {
  ExecuteDataQueryResponseDto,
  ValidateDataQueryResponseDto,
  IEndpointResult,
} from '@teable/v2-contract-http';
import {
  executeDataQueryEndpoint,
  validateDataQueryEndpoint,
} from '@teable/v2-contract-http-implementation/data-query';
import {
  TableQueryTraceAttributes,
  TableByIdSpec,
  v2CoreTokens,
  type ITableRepository,
  type Table,
  type DomainError,
  type RecordQueryPluginRunner,
} from '@teable/v2-core';
import {
  DataQueryService,
  QueryExecutionService,
  traceDataQueryStage,
  type BoundDataQueryComposition,
  type IDataQueryExecutor,
} from '@teable/v2-data-query';
import type { Kysely } from 'kysely';
import { ClsService } from 'nestjs-cls';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { BaseConfig, type IBaseConfig } from '../../configs/base.config';
import type { IDataDbRoutingSnapshot } from '../../global/data-db-client-manager.service';
import { withPgParameterRedaction } from '../../tracing-db-context';
import type { IClsStore } from '../../types/cls';
import { V2ContainerService } from './v2-container.service';
import { admitDataQueryResource, type IDataQueryAdmissionDb } from './v2-data-query-admission';
import { V2DataQueryCandidateService } from './v2-data-query-candidate.service';
import { resolveDataQueryFormulaSqlOptions } from './v2-data-query-formula-sql';
import { dataQueryErrorResponse, dataQueryHostError } from './v2-data-query-http';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';

function mapLibraryAdmissionError(error: unknown): unknown {
  if (
    error instanceof UnauthorizedException ||
    error instanceof NotFoundException ||
    error instanceof ForbiddenException
  ) {
    return new NotFoundException();
  }
  return error;
}

/** Authentication, resource admission and tenant placement remain host responsibilities. */
@Injectable()
export class V2DataQueryService {
  private readonly discoveryMetadata = new AsyncLocalStorage<
    Map<string, Result<Table, DomainError>>
  >();

  withLibraryDiscoveryMetadata<T>(callback: () => Promise<T>): Promise<T> {
    return this.discoveryMetadata.run(new Map(), callback);
  }

  constructor(
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    private readonly cls: ClsService<IClsStore>,
    private readonly candidates: V2DataQueryCandidateService,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {}

  execute(raw: unknown): Promise<IEndpointResult<ExecuteDataQueryResponseDto>> {
    return this.run(raw, 'execute');
  }

  validate(
    raw: unknown,
    authorization?: string
  ): Promise<IEndpointResult<ValidateDataQueryResponseDto>> {
    return this.cls.runWith({ ...this.cls.get(), v2PreviewReadOnly: true }, () =>
      this.run(raw, 'validate', authorization)
    );
  }

  /** Admit library requests under their actual member role and the signed Base ceiling. */
  async admitLibrary(
    baseId: string,
    write = false
  ): Promise<{ userId: string; kind: 'user' | 'app'; baseId: string }> {
    const userId = this.cls.get('user.id');
    const signedBase = this.cls.get('tempAuthBaseId');
    if (
      !userId ||
      isAnonymous(userId) ||
      (isRobot(userId) && userId !== APP_ROBOT_ID) ||
      (signedBase && signedBase !== baseId) ||
      (userId === APP_ROBOT_ID && (!signedBase || write)) ||
      this.hasLibraryExcludedContext()
    ) {
      throw new NotFoundException();
    }
    const container = await this.containers.getPreviewContainer();
    const db = container.resolve<Kysely<IDataQueryAdmissionDb>>(v2MetaDbTokens.db);
    try {
      const admission = await admitDataQueryResource(db, baseId, {
        actorId: userId,
        departmentIds: this.cls.get('organization.departments')?.map(({ id }) => id) ?? [],
        tempAuthBaseId: userId === APP_ROBOT_ID ? signedBase : undefined,
        accessTokenId: this.cls.get('accessTokenId'),
      });
      if (
        admission.template ||
        !admission.permissions.includes('base|read') ||
        (write && !admission.permissions.includes('base|save_query'))
      ) {
        throw new NotFoundException();
      }
    } catch (error) {
      throw mapLibraryAdmissionError(error);
    }
    return { userId, kind: userId === APP_ROBOT_ID ? 'app' : 'user', baseId };
  }

  private hasLibraryExcludedContext(): boolean {
    return !!(
      this.cls.get('shareViewId') ||
      this.cls.get('baseShareId') ||
      this.cls.get('baseShare') ||
      this.cls.get('template') ||
      this.cls.get('workflowContext')
    );
  }

  async validateLibrary(baseId: string, raw: unknown) {
    const principal = await this.admitLibrary(baseId);
    return this.cls.runWith(
      {
        ...this.cls.get(),
        v2PreviewReadOnly: true,
        tempAuthBaseId: principal.kind === 'app' ? baseId : undefined,
      },
      () => this.run(raw, 'validate', undefined, baseId)
    );
  }

  async executeLibrary(baseId: string, raw: unknown, composition?: BoundDataQueryComposition) {
    const principal = await this.admitLibrary(baseId);
    return this.cls.runWith(
      { ...this.cls.get(), tempAuthBaseId: principal.kind === 'app' ? baseId : undefined },
      () => this.run(raw, 'execute', undefined, baseId, composition)
    );
  }

  private run(
    raw: unknown,
    operation: 'execute',
    authorization?: string,
    expectedBaseId?: string,
    composition?: BoundDataQueryComposition
  ): Promise<IEndpointResult<ExecuteDataQueryResponseDto>>;
  private run(
    raw: unknown,
    operation: 'validate',
    authorization?: string,
    expectedBaseId?: string
  ): Promise<IEndpointResult<ValidateDataQueryResponseDto>>;
  private async run(
    raw: unknown,
    operation: 'execute' | 'validate',
    authorization?: string,
    expectedBaseId?: string,
    composition?: BoundDataQueryComposition
  ): Promise<IEndpointResult<ExecuteDataQueryResponseDto | ValidateDataQueryResponseDto>> {
    try {
      const actorId = this.cls.get('user.id');
      if (!actorId || isAnonymous(actorId)) throw new UnauthorizedException();
      const metadataContainer = await (operation === 'validate'
        ? this.containers.getPreviewContainer()
        : this.containers.getContainer());
      const context = await this.contexts.createContext(metadataContainer);
      const tables = metadataContainer.resolve<ITableRepository>(v2CoreTokens.tableRepository);
      const metaDb = metadataContainer.resolve<Kysely<IDataQueryAdmissionDb>>(v2MetaDbTokens.db);
      let routingSnapshot: IDataDbRoutingSnapshot | undefined;
      const executor: IDataQueryExecutor = {
        execute: async (executionContext, table, query, scope, binding, derived) => {
          try {
            if (!routingSnapshot) throw new Error('Query resource has not been admitted');
            const snapshot = routingSnapshot;
            const route = await traceDataQueryStage(
              executionContext,
              'routing.resolve',
              { [TableQueryTraceAttributes.SPACE_ID]: snapshot.spaceId },
              async () => ok(await this.containers.getContainerForRoutingSnapshot(snapshot))
            );
            if (route.isErr()) return err(route.error);
            const dataContainer = route.value;
            const postgres = new PostgresDataQueryExecutor(
              dataContainer.resolve(v2DataDbTokens.db),
              {
                ...resolveDataQueryFormulaSqlOptions(dataContainer),
                cursorSigningKey: this.baseConfig.dataQueryCursorSigningKey,
              }
            );
            return await postgres.execute(executionContext, table, query, scope, binding, derived);
          } catch (error) {
            return err(dataQueryHostError(error));
          }
        },
        executeRelation: async (executionContext, plan, derived) => {
          try {
            if (!routingSnapshot) throw new Error('Query resource has not been admitted');
            const snapshot = routingSnapshot;
            const route = await traceDataQueryStage(
              executionContext,
              'routing.resolve',
              { [TableQueryTraceAttributes.SPACE_ID]: snapshot.spaceId },
              async () => ok(await this.containers.getContainerForRoutingSnapshot(snapshot))
            );
            if (route.isErr()) return err(route.error);
            const dataContainer = route.value;
            const postgres = new PostgresDataQueryExecutor(
              dataContainer.resolve(v2DataDbTokens.db),
              {
                ...resolveDataQueryFormulaSqlOptions(dataContainer),
                cursorSigningKey: this.baseConfig.dataQueryCursorSigningKey,
              }
            );
            return await postgres.executeRelation(executionContext, plan, derived);
          } catch (error) {
            return err(dataQueryHostError(error));
          }
        },
      };
      const dataQueries = new DataQueryService(
        {
          findOne: async (executionContext, specification) => {
            const key =
              operation === 'validate' && specification instanceof TableByIdSpec
                ? specification.tableId().toString()
                : undefined;
            const cache = this.discoveryMetadata.getStore();
            const table =
              (key && cache?.get(key)) || (await tables.findOne(executionContext, specification));
            if (table.isErr()) return table;
            try {
              if (expectedBaseId && table.value.baseId().toString() !== expectedBaseId) {
                throw new NotFoundException();
              }
              const admitted = await traceDataQueryStage(
                executionContext,
                'metadata.admit',
                { [TableQueryTraceAttributes.TABLE_ID]: table.value.id().toString() },
                async () =>
                  ok(
                    await admitDataQueryResource(metaDb, table.value.baseId().toString(), {
                      actorId,
                      departmentIds:
                        this.cls.get('organization.departments')?.map(({ id }) => id) ?? [],
                      tempAuthBaseId: this.cls.get('tempAuthBaseId'),
                      accessTokenId: this.cls.get('accessTokenId'),
                    })
                  )
              );
              if (admitted.isErr()) return err(admitted.error);
              const admission = admitted.value;
              this.cls.set('spaceId', admission.spaceId);
              routingSnapshot = admission;
              this.cls.set('permissions', admission.permissions);
              if (admission.template) this.cls.set('template', admission.template);
              if (key) cache?.set(key, table);
              return table;
            } catch (error) {
              return err(dataQueryHostError(error));
            }
          },
        },
        metadataContainer.resolve<RecordQueryPluginRunner>(v2CoreTokens.recordQueryPluginRunner),
        executor,
        (executionContext, candidate, proof) =>
          this.candidates.prepareAuthorizedCandidate(
            executionContext,
            candidate,
            proof,
            authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]
          )
      );
      const service = new QueryExecutionService(dataQueries);
      return await withPgParameterRedaction(() =>
        operation === 'validate'
          ? validateDataQueryEndpoint(context, raw, service)
          : executeDataQueryEndpoint(
              context,
              raw,
              composition
                ? { execute: (ctx, input) => service.executeComposition(ctx, input, composition) }
                : service
            )
      );
    } catch (error) {
      return dataQueryErrorResponse(dataQueryHostError(error));
    }
  }
}
