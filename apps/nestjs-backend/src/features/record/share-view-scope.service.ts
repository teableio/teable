import { Injectable } from '@nestjs/common';
import type { FieldKeyType, IFieldVo, IFilter, IViewVo } from '@teable/core';
import { HttpErrorCode, isAnonymous } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateRecordsRo,
  IFormSubmitRo,
  IPasteRo,
  IRecordInsertOrderRo,
  IRangesRo,
  IUpdateRecordRo,
  IUpdateRecordsRo,
} from '@teable/openapi';
import { uniq } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { isNotHiddenField } from '../../utils/is-not-hidden-field';
import { createViewVoByRaw } from '../view/model/factory';
import { RecordService } from './record.service';

type IShareViewScope = {
  shareId: string;
  tableId: string;
  view: IViewVo;
};

type IFieldKey = keyof Pick<IFieldVo, 'id' | 'name' | 'dbFieldName'>;

type IWritableField = {
  id: string;
  name: string;
  dbFieldName: string;
  isPrimary: boolean | null;
};

@Injectable()
export class ShareViewScopeService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  private restricted(message: string) {
    return new CustomHttpException(message, HttpErrorCode.RESTRICTED_RESOURCE, {
      localization: {
        i18nKey: 'httpErrors.permission.notAllowedOperation',
      },
    });
  }

  private async getScope(tableId: string): Promise<IShareViewScope | null> {
    const shareId = this.cls.get('shareViewId');
    if (!shareId) {
      return null;
    }

    // Per-request cache: a single mutation often triggers multiple assert*
    // calls (record + field + order). One DB lookup per request is enough —
    // share metadata doesn't change mid-request.
    const cacheKey = `${shareId}:${tableId}`;
    let cache = this.cls.get('shareViewScopeCache');
    if (!cache) {
      cache = new Map();
      this.cls.set('shareViewScopeCache', cache);
    }
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) as IShareViewScope | null;
    }

    const scope = await this.loadScope(shareId, tableId);
    cache.set(cacheKey, scope);
    return scope;
  }

  private async loadScope(shareId: string, tableId: string): Promise<IShareViewScope | null> {
    const viewRaw = await this.prismaService.view.findFirst({
      where: { shareId, enableShare: true, deletedTime: null },
    });
    if (!viewRaw || viewRaw.tableId !== tableId) {
      throw this.restricted(`Table ${tableId} is not accessible through share view ${shareId}`);
    }

    const view = createViewVoByRaw(viewRaw);
    if (!view.shareMeta?.allowEdit || isAnonymous(this.cls.get('user.id'))) {
      throw this.restricted(`Share view ${shareId} is read-only for this viewer`);
    }

    return { shareId, tableId, view };
  }

  private async getWritableFields(scope: IShareViewScope) {
    // A single paste calls assertFieldIdsWritable 2-4 times (projection,
    // order/group, search, header). Cache the resolved list per request so
    // we don't re-query the same field set on every assertion.
    const cacheKey = `${scope.shareId}:${scope.tableId}:fields`;
    const cache = this.cls.get('shareViewScopeCache');
    if (cache?.has(cacheKey)) {
      return cache.get(cacheKey) as IWritableField[];
    }

    const fields = await this.prismaService.field.findMany({
      where: { tableId: scope.tableId, deletedTime: null },
      select: {
        id: true,
        name: true,
        dbFieldName: true,
        isPrimary: true,
      },
      orderBy: { order: 'asc' },
    });

    const writable = scope.view.shareMeta?.includeHiddenField
      ? fields
      : fields.filter((field) => field.isPrimary || isNotHiddenField(field.id, scope.view));

    cache?.set(cacheKey, writable);
    return writable;
  }

  private getFieldKey(fieldKeyType?: FieldKeyType): IFieldKey {
    if (fieldKeyType === 'id') return 'id';
    if (fieldKeyType === 'dbFieldName') return 'dbFieldName';
    return 'name';
  }

  private async assertFieldKeysWritable(
    scope: IShareViewScope,
    fieldKeys: string[],
    fieldKeyType?: FieldKeyType
  ) {
    if (!fieldKeys.length) {
      return;
    }

    const key = this.getFieldKey(fieldKeyType);
    const writableFields = await this.getWritableFields(scope);
    const writableKeys = new Set(
      writableFields
        .map((field) => field[key])
        .filter((fieldKey): fieldKey is string => Boolean(fieldKey))
    );
    const deniedKeys = uniq(fieldKeys).filter((fieldKey) => !writableKeys.has(fieldKey));
    if (deniedKeys.length) {
      throw this.restricted(
        `Field(${deniedKeys.join(',')}) is not writable through share view ${scope.shareId}`
      );
    }
  }

  private async assertFieldIdsWritable(scope: IShareViewScope, fieldIds?: string[]) {
    if (!fieldIds?.length) {
      return;
    }
    await this.assertFieldKeysWritable(scope, fieldIds, 'id' as FieldKeyType);
  }

  private async assertRecordIdsVisible(scope: IShareViewScope, recordIds: string[]) {
    const ids = uniq(recordIds.filter(Boolean));
    if (!ids.length) {
      return;
    }

    if (!scope.view.shareMeta?.includeRecords) {
      throw this.restricted(`Share view ${scope.shareId} does not expose records`);
    }

    const deniedIds = await this.recordService.getDiffIdsByIdAndFilter(
      scope.tableId,
      ids,
      scope.view.filter as IFilter | undefined
    );
    if (deniedIds.length) {
      throw this.restricted(
        `Record(${deniedIds.join(',')}) is not writable through share view ${scope.shareId}`
      );
    }
  }

  private async assertOrderInScope(scope: IShareViewScope, order?: IRecordInsertOrderRo) {
    if (!order) {
      return;
    }
    if (order.viewId !== scope.view.id) {
      throw this.restricted(`Record order must target share view ${scope.view.id}`);
    }
    await this.assertRecordIdsVisible(scope, [order.anchorId]);
  }

  async assertUpdateRecord(tableId: string, recordId: string, updateRecordRo: IUpdateRecordRo) {
    const scope = await this.getScope(tableId);
    if (!scope) {
      return;
    }

    await this.assertRecordIdsVisible(scope, [recordId]);
    await this.assertFieldKeysWritable(
      scope,
      Object.keys(updateRecordRo.record.fields ?? {}),
      updateRecordRo.fieldKeyType
    );
    await this.assertOrderInScope(scope, updateRecordRo.order);
  }

  async assertUpdateRecords(tableId: string, updateRecordsRo: IUpdateRecordsRo) {
    const scope = await this.getScope(tableId);
    if (!scope) {
      return;
    }

    await this.assertRecordIdsVisible(
      scope,
      updateRecordsRo.records?.map((record) => record.id) ?? []
    );
    await this.assertFieldKeysWritable(
      scope,
      updateRecordsRo.records?.flatMap((record) => Object.keys(record.fields ?? {})) ?? [],
      updateRecordsRo.fieldKeyType
    );
    await this.assertOrderInScope(scope, updateRecordsRo.order);
  }

  async assertCreateRecords(tableId: string, createRecordsRo: ICreateRecordsRo) {
    const scope = await this.getScope(tableId);
    if (!scope) {
      return;
    }

    await this.assertFieldKeysWritable(
      scope,
      createRecordsRo.records?.flatMap((record) => Object.keys(record.fields ?? {})) ?? [],
      createRecordsRo.fieldKeyType
    );
    await this.assertOrderInScope(scope, createRecordsRo.order);
  }

  async assertDeleteRecords(tableId: string, recordIds: string[]) {
    const scope = await this.getScope(tableId);
    if (!scope) {
      return;
    }

    await this.assertRecordIdsVisible(scope, recordIds);
  }

  async assertFormSubmit(tableId: string, formSubmitRo: IFormSubmitRo) {
    const scope = await this.getScope(tableId);
    if (!scope) {
      return;
    }

    if (formSubmitRo.viewId !== scope.view.id) {
      throw this.restricted(`Form submit must target share view ${scope.view.id}`);
    }
    await this.assertFieldKeysWritable(scope, Object.keys(formSubmitRo.fields ?? {}));
  }

  private async assertSelectionQuery(scope: IShareViewScope, query: IRangesRo | IPasteRo) {
    if (query.viewId !== scope.view.id) {
      throw this.restricted(`Selection operation must target share view ${scope.view.id}`);
    }
    if (query.ignoreViewQuery) {
      throw this.restricted('Selection operation cannot ignore the share view query');
    }
    if (query.filter) {
      throw this.restricted('Selection operation cannot override the share view filter');
    }
    if (!query.projection?.length) {
      throw this.restricted('Selection operation must declare a share-view field projection');
    }

    await this.assertFieldIdsWritable(scope, query.projection);

    const orderAndGroupFieldIds = [
      ...(query.orderBy?.map((item) => item.fieldId) ?? []),
      ...(query.groupBy?.map((item) => item.fieldId) ?? []),
    ];
    await this.assertFieldIdsWritable(scope, orderAndGroupFieldIds);

    const searchFieldId = query.search?.[1];
    if (searchFieldId) {
      await this.assertFieldIdsWritable(scope, [searchFieldId]);
    }
  }

  async assertSelectionMutation(tableId: string, query: IRangesRo) {
    const scope = await this.getScope(tableId);
    if (!scope) {
      return;
    }

    await this.assertSelectionQuery(scope, query);
  }

  async assertPaste(tableId: string, pasteRo: IPasteRo) {
    const scope = await this.getScope(tableId);
    if (!scope) {
      return;
    }

    await this.assertSelectionQuery(scope, pasteRo);
    await this.assertFieldIdsWritable(scope, pasteRo.header?.map((field) => field.id) ?? []);
  }
}
