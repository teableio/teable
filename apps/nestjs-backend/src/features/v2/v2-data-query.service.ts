import { Injectable, UnauthorizedException } from '@nestjs/common';
import { isAnonymous } from '@teable/core';
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
  v2CoreTokens,
  type ITableRepository,
  type RecordQueryPluginRunner,
} from '@teable/v2-core';
import {
  DataQueryService,
  QueryExecutionService,
  traceDataQueryStage,
  type IDataQueryExecutor,
} from '@teable/v2-data-query';
import type { Kysely } from 'kysely';
import { ClsService } from 'nestjs-cls';
import { err, ok } from 'neverthrow';
import type { IDataDbRoutingSnapshot } from '../../global/data-db-client-manager.service';
import { withPgParameterRedaction } from '../../tracing-db-context';
import type { IClsStore } from '../../types/cls';
import { V2ContainerService } from './v2-container.service';
import { admitDataQueryResource, type IDataQueryAdmissionDb } from './v2-data-query-admission';
import { dataQueryErrorResponse, dataQueryHostError } from './v2-data-query-http';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';

/** Authentication, resource admission and tenant placement remain host responsibilities. */
@Injectable()
export class V2DataQueryService {
  constructor(
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    private readonly cls: ClsService<IClsStore>
  ) {}

  execute(raw: unknown): Promise<IEndpointResult<ExecuteDataQueryResponseDto>> {
    return this.run(raw, 'execute');
  }

  validate(raw: unknown): Promise<IEndpointResult<ValidateDataQueryResponseDto>> {
    return this.run(raw, 'validate');
  }

  private run(
    raw: unknown,
    operation: 'execute'
  ): Promise<IEndpointResult<ExecuteDataQueryResponseDto>>;
  private run(
    raw: unknown,
    operation: 'validate'
  ): Promise<IEndpointResult<ValidateDataQueryResponseDto>>;
  private async run(
    raw: unknown,
    operation: 'execute' | 'validate'
  ): Promise<IEndpointResult<ExecuteDataQueryResponseDto | ValidateDataQueryResponseDto>> {
    try {
      const actorId = this.cls.get('user.id');
      if (!actorId || isAnonymous(actorId)) throw new UnauthorizedException();
      const metadataContainer = await this.containers.getContainer();
      const context = await this.contexts.createContext(metadataContainer);
      const tables = metadataContainer.resolve<ITableRepository>(v2CoreTokens.tableRepository);
      const metaDb = metadataContainer.resolve<Kysely<IDataQueryAdmissionDb>>(v2MetaDbTokens.db);
      let routingSnapshot: IDataDbRoutingSnapshot | undefined;
      const executor: IDataQueryExecutor = {
        execute: async (executionContext, table, query, scope) => {
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
              dataContainer.resolve(v2DataDbTokens.db)
            );
            return await postgres.execute(executionContext, table, query, scope);
          } catch (error) {
            return err(dataQueryHostError(error));
          }
        },
        executeRelation: async (executionContext, plan) => {
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
              dataContainer.resolve(v2DataDbTokens.db)
            );
            return await postgres.executeRelation(executionContext, plan);
          } catch (error) {
            return err(dataQueryHostError(error));
          }
        },
      };
      const dataQueries = new DataQueryService(
        {
          findOne: async (executionContext, specification) => {
            const table = await tables.findOne(executionContext, specification);
            if (table.isErr()) return table;
            try {
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
              return table;
            } catch (error) {
              return err(dataQueryHostError(error));
            }
          },
        },
        metadataContainer.resolve<RecordQueryPluginRunner>(v2CoreTokens.recordQueryPluginRunner),
        executor
      );
      const service = new QueryExecutionService(dataQueries);
      return await withPgParameterRedaction(() =>
        operation === 'validate'
          ? validateDataQueryEndpoint(context, raw, service)
          : executeDataQueryEndpoint(context, raw, service)
      );
    } catch (error) {
      return dataQueryErrorResponse(dataQueryHostError(error));
    }
  }
}
