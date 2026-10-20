import { Injectable, UnauthorizedException } from '@nestjs/common';
import { isAnonymous } from '@teable/core';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { PostgresDataQueryExplainer } from '@teable/v2-adapter-table-repository-postgres';
import {
  explainDataQueryResponseDtoSchema,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  type ExplainDataQueryResponseDto,
  type IEndpointResult,
} from '@teable/v2-contract-http';
import { explainDataQueryEndpoint } from '@teable/v2-contract-http-implementation/data-query-explain';
import {
  TableQueryTraceAttributes,
  v2CoreTokens,
  type ITableRepository,
  type RecordQueryPluginRunner,
} from '@teable/v2-core';
import {
  DataQueryExplainService,
  QueryExplainExecutionService,
  traceDataQueryStage,
  type IDataQueryExplainer,
} from '@teable/v2-data-query';
import type { Kysely } from 'kysely';
import { ClsService } from 'nestjs-cls';
import { err, ok } from 'neverthrow';
import type { IDataDbRoutingSnapshot } from '../../global/data-db-client-manager.service';
import { withPgParameterRedaction } from '../../tracing-db-context';
import type { IClsStore } from '../../types/cls';
import { V2ContainerService } from './v2-container.service';
import { admitDataQueryResource, type IDataQueryAdmissionDb } from './v2-data-query-admission';
import { dataQueryHostError } from './v2-data-query-http';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';

const explainErrorResponse = (
  error: Parameters<typeof mapDomainErrorToHttpError>[0]
): IEndpointResult<ExplainDataQueryResponseDto> => ({
  status: mapDomainErrorToHttpStatus(error),
  body: explainDataQueryResponseDtoSchema.parse({
    ok: false,
    error: mapDomainErrorToHttpError(error),
  }),
});

/**
 * Same host admission, tenant routing and identity as execute. Explain adds no
 * route-level authority: it cannot read rows and exposes caller-scoped SQL only.
 */
@Injectable()
export class V2DataQueryExplainService {
  constructor(
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async explain(raw: unknown): Promise<IEndpointResult<ExplainDataQueryResponseDto>> {
    try {
      const actorId = this.cls.get('user.id');
      if (!actorId || isAnonymous(actorId)) throw new UnauthorizedException();
      const metadataContainer = await this.containers.getContainer();
      const context = await this.contexts.createContext(metadataContainer);
      const tables = metadataContainer.resolve<ITableRepository>(v2CoreTokens.tableRepository);
      const metaDb = metadataContainer.resolve<Kysely<IDataQueryAdmissionDb>>(v2MetaDbTokens.db);
      let routingSnapshot: IDataDbRoutingSnapshot | undefined;
      const explainer: IDataQueryExplainer = {
        explain: async (executionContext, table, query, scope) => {
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
            return await new PostgresDataQueryExplainer(
              route.value.resolve(v2DataDbTokens.db)
            ).explain(executionContext, table, query, scope);
          } catch (error) {
            return err(dataQueryHostError(error));
          }
        },
      };
      const explainService = new DataQueryExplainService(
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
        explainer
      );
      return await withPgParameterRedaction(() =>
        explainDataQueryEndpoint(context, raw, new QueryExplainExecutionService(explainService))
      );
    } catch (error) {
      return explainErrorResponse(dataQueryHostError(error));
    }
  }
}
