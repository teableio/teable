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

/**
 * The query surface shared by every selection endpoint. Both the range-based
 * ro (`IRangesRo`/`IPasteRo`) and the id-based ones (`IClearByIdRo`,
 * `IDeleteByIdRo`, `IPasteByIdRo`, `ISelectionIdsRo`) extend the same
 * `contentQueryBaseSchema`, so one shape covers both families.
 */
type ISelectionScopeQuery = Pick<
  IRangesRo,
  'viewId' | 'ignoreViewQuery' | 'filter' | 'projection' | 'orderBy' | 'groupBy' | 'search'
>;

/**
 * An id-based selection ro. `recordIds`/`fieldIds` are caller supplied and are
 * NOT constrained by the query above, so they need their own assertions; when
 * they are omitted the target set falls back to the (pinned) query scope.
 */
type ISelectionIdScopeRo = ISelectionScopeQuery & {
  selection: {
    recordIds?: string[];
    fieldIds?: string[];
  };
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

  /**
   * Pin the query to the shared view: same view, no query override. Once these
   * hold, whatever the endpoint resolves from the query (records passing the
   * view filter, fields visible in the view) is inside the share scope by
   * construction — which is what makes an omitted `recordIds`/`projection`
   * safe on the id-based endpoints.
   */
  private async assertSelectionQuery(
    scope: IShareViewScope,
    query: ISelectionScopeQuery,
    options?: { requireProjection?: boolean }
  ) {
    if (query.viewId !== scope.view.id) {
      throw this.restricted(`Selection operation must target share view ${scope.view.id}`);
    }
    if (query.ignoreViewQuery) {
      throw this.restricted('Selection operation cannot ignore the share view query');
    }
    if (query.filter) {
      throw this.restricted('Selection operation cannot override the share view filter');
    }
    // Range endpoints address cells by column offset, so they must spell out the
    // projection the offsets are resolved against. The id-based endpoints fall
    // back to the view's own visible fields, which is already in scope.
    if (options?.requireProjection && !query.projection?.length) {
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

    await this.assertSelectionQuery(scope, query, { requireProjection: true });
  }

  async assertPaste(tableId: string, pasteRo: IPasteRo) {
    const scope = await this.getScope(tableId);
    if (!scope) {
      return;
    }

    await this.assertSelectionQuery(scope, pasteRo, { requireProjection: true });
  }

  private async assertIdScope(scope: IShareViewScope, selectionRo: ISelectionIdScopeRo) {
    await this.assertSelectionQuery(scope, selectionRo);
    // An id-based mutation always resolves a record set — the explicit ids when
    // given, the pinned view query otherwise. assertRecordIdsVisible only
    // enforces includeRecords when it is handed ids, so check it here too:
    // a share that does not expose records must not be able to write them.
    // The permission layer already refuses record writes without
    // includeRecords; this keeps the scope service self-contained, the way
    // loadScope re-checks allowEdit.
    if (!scope.view.shareMeta?.includeRecords) {
      throw this.restricted(`Share view ${scope.shareId} does not expose records`);
    }
    await this.assertFieldIdsWritable(scope, selectionRo.selection.fieldIds);
    await this.assertRecordIdsVisible(scope, selectionRo.selection.recordIds ?? []);
  }

  /**
   * Id-based sibling of {@link assertSelectionMutation}, for the
   * `clear-by-id` / `delete-by-id` families and their `-stream` variants.
   */
  async assertSelectionIdMutation(tableId: string, selectionRo: ISelectionIdScopeRo) {
    const scope = await this.getScope(tableId);
    if (!scope) {
      return;
    }

    await this.assertIdScope(scope, selectionRo);
  }

  /**
   * Id-based sibling of {@link assertPaste}.
   *
   * `pasteRo.header` is deliberately not checked here (nor in assertPaste): it
   * carries the *source* table's field VOs, which the paste uses positionally
   * to convert clipboard values into the destination's cell types. It never
   * selects destination cells — those come from `selection.fieldIds` /
   * `projection` / the view's visible fields, all asserted above — and the one
   * place header can create fields (expandColumns) is gated on `field|create`,
   * which a share view never grants. Validating it as a writable field set only
   * broke pasting content copied from another table.
   */
  async assertPasteById(tableId: string, pasteRo: ISelectionIdScopeRo) {
    const scope = await this.getScope(tableId);
    if (!scope) {
      return;
    }

    await this.assertIdScope(scope, pasteRo);
  }
}
