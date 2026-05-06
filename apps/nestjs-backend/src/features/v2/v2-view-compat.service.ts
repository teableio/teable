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
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { snakeCase } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { fromZodError } from 'zod-validation-error';
import { CustomHttpException } from '../../custom.exception';
import type { IRawOp, IRawOpMap } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { V2ContainerService } from './v2-container.service';

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
    private readonly cls: ClsService<IClsStore>
  ) {}

  private async getDb(): Promise<Kysely<IV2ViewCompatDb>> {
    const container = await this.v2ContainerService.getContainer();
    return container.resolve<Kysely<IV2ViewCompatDb>>(v2MetaDbTokens.db);
  }

  private mergeSetViewPropertyByOpContexts(opContexts: ISetViewPropertyOpContext[]) {
    const result: Record<string, string | number | boolean | null> = {};
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
      result[key] =
        parsedValue == null
          ? null
          : typeof parsedValue === 'object'
            ? JSON.stringify(parsedValue)
            : parsedValue;
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
  ): IRawOpMap {
    const collection = `${IdPrefix.View}_${tableId}`;
    const rawOpMap: IRawOpMap = { [collection]: {} };
    const baseRaw = {
      src: this.cls.getId() || 'unknown',
      seq: 1,
      m: {
        ts: Date.now(),
      },
    };

    dataList.forEach(({ docId, version, data }) => {
      rawOpMap[collection][docId] = {
        ...baseRaw,
        op: data as IOtOperation[],
        v: version,
      } as IRawOp;
    });

    const prevMap = this.cls.get('tx.rawOpMaps') || [];
    prevMap.push(rawOpMap);
    this.cls.set('tx.rawOpMaps', prevMap);
    return rawOpMap;
  }

  async batchUpdateViewByOps(tableId: string, opsMap: { [viewId: string]: IOtOperation[] }) {
    const updatedViewIds = Object.keys(opsMap);
    if (!updatedViewIds.length) {
      return;
    }

    const db = await this.getDb();
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

      const dbValues = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [snakeCase(key), value])
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
