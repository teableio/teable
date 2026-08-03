import { Injectable } from '@nestjs/common';
import {
  HttpErrorCode,
  IdPrefix,
  OpName,
  ViewOpBuilder,
  viewVoSchema,
  type IOtOperation,
  type ISetViewPropertyOpContext,
} from '@teable/core';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  v2CoreTokens,
  ViewOperationKind,
  type DomainError,
  type IExecutionContext,
  type ViewOperationPayloadViewConfig,
  type ViewOperationPluginContext,
  type ViewOperationPluginRunner,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { snakeCase } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { fromZodError } from 'zod-validation-error';
import { CustomHttpException } from '../../custom.exception';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { BatchService } from '../calculation/batch.service';
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';

/* eslint-disable @typescript-eslint/naming-convention */
type IV2ViewCompatDb = V1TeableDatabase & {
  view: {
    id: string;
    table_id: string;
    version: number;
    deleted_time: Date | null;
    last_modified_by: string | null;
    options: string | null;
    filter: string | null;
    group: string | null;
    sort: string | null;
    share_id: string | null;
    share_meta: string | null;
    enable_share: boolean | null;
    is_locked: boolean | null;
  };
};
/* eslint-enable @typescript-eslint/naming-convention */

@Injectable()
export class V2ViewCompatService {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly cls: ClsService<IClsStore>,
    private readonly batchService: BatchService,
    private readonly v2ContextFactory: V2ExecutionContextFactory
  ) {}

  private throwDomainError(error: DomainError): never {
    throw new CustomHttpException(error.message, HttpErrorCode.VALIDATION_ERROR, {
      domainCode: error.code,
      domainTags: error.tags,
      details: error.details,
    });
  }

  private mergeSetViewPropertyByOpContexts(opContexts: ISetViewPropertyOpContext[]) {
    const result: Record<string, unknown> = {};
    for (const opContext of opContexts) {
      const { key, newValue } = opContext;
      const parseResult = viewVoSchema.partial().safeParse({ [key]: newValue });
      if (!parseResult.success) {
        throw new CustomHttpException(
          fromZodError(parseResult.error).message,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.view.propertyParseError',
            },
          }
        );
      }

      const parsedValue = parseResult.data[key];
      result[key] = parsedValue == null ? null : parsedValue;
    }

    return result;
  }

  private getUpdateViewProperties(ops: IOtOperation[]) {
    const setPropertyOpContexts = ops.flatMap((op) => {
      const context = ViewOpBuilder.detect(op);
      if (!context) {
        throw new CustomHttpException(`unknown view editing op`, HttpErrorCode.VALIDATION_ERROR, {
          localization: {
            i18nKey: 'httpErrors.custom.invalidOperation',
          },
        });
      }

      if (context.name !== OpName.SetViewProperty) {
        return [];
      }

      return [context as ISetViewPropertyOpContext];
    });

    return this.mergeSetViewPropertyByOpContexts(setPropertyOpContexts);
  }

  private saveRawOps(
    tableId: string,
    dataList: { docId: string; version: number; data?: unknown }[]
  ) {
    return this.batchService.saveRawOps(tableId, RawOpType.Edit, IdPrefix.View, dataList);
  }

  private async ensureViewOperation(
    runner: ViewOperationPluginRunner,
    executionContext: IExecutionContext,
    context: ViewOperationPluginContext
  ): Promise<void> {
    const preparedResult = await runner.prepare(context);
    if (preparedResult.isErr()) {
      this.throwDomainError(preparedResult.error);
    }

    const guardResult = await preparedResult.value.guard(executionContext);
    if (guardResult.isErr()) {
      this.throwDomainError(guardResult.error);
    }
  }

  async batchUpdateViewByOps(
    tableId: string,
    opsMap: { [viewId: string]: IOtOperation[] },
    context?: IExecutionContext
  ) {
    const updatedViewIds = Object.keys(opsMap);
    if (!updatedViewIds.length) {
      return;
    }

    const container = await this.v2ContainerService.getContainer();
    const db = container.resolve<Kysely<IV2ViewCompatDb>>(v2MetaDbTokens.db);
    const viewOperationPluginRunner = container.resolve<ViewOperationPluginRunner>(
      v2CoreTokens.viewOperationPluginRunner
    );
    const executionContext = context ?? (await this.v2ContextFactory.createContext());
    const views = await db
      .selectFrom('view')
      .where('id', 'in', updatedViewIds)
      .where('table_id', '=', tableId)
      .where('deleted_time', 'is', null)
      .select(['id', 'version'])
      .execute();

    const userId = this.cls.get('user.id') ?? null;
    const updatedViews: { docId: string; version: number; data: IOtOperation[] }[] = [];

    for (const view of views) {
      const properties = this.getUpdateViewProperties(opsMap[view.id] ?? []);
      if (!Object.keys(properties).length) {
        continue;
      }

      await this.ensureViewOperation(viewOperationPluginRunner, executionContext, {
        kind: ViewOperationKind.update,
        executionContext,
        payload: {
          tableId,
          viewId: view.id,
          patch: properties as ViewOperationPayloadViewConfig,
        },
        isTransactionBound: false,
      });

      const dbValues = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          snakeCase(key),
          value == null ? null : typeof value === 'object' ? JSON.stringify(value) : value,
        ])
      );

      await db
        .updateTable('view')
        .set({
          ...dbValues,
          version: view.version + 1,
          last_modified_by: userId,
        })
        .where('id', '=', view.id)
        .execute();

      updatedViews.push({
        docId: view.id,
        version: view.version,
        data: opsMap[view.id] ?? [],
      });
    }

    if (!updatedViews.length) {
      return;
    }

    this.saveRawOps(tableId, updatedViews);
  }
}
